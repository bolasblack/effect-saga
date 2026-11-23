import { Cause, Effect, Exit, Fiber, Layer, ManagedRuntime } from 'effect'
import { Store as ReduxStore, StoreEnhancer } from 'redux'
import { makeStoreService, StoreService } from '../core'
import { defer } from '../helpers/defer'
import {
  subscribeStoreActionEnhancerFactory,
  SubscribeStoreActionFn,
} from './subscribeStoreActionEnhancerFactory'

export interface StoreExt {
  subscribeAction: SubscribeStoreActionFn
}

export const effectSagaEnhancerFactory =
  (setStore: (store: ReduxStore & StoreExt) => void): StoreEnhancer<StoreExt> =>
  next => {
    const subscribeStoreActionEnhancer = subscribeStoreActionEnhancerFactory()

    const wrapper = subscribeStoreActionEnhancer(next)

    return (reducer, preloadedState) => {
      const store = wrapper(reducer, preloadedState)

      setStore(store)

      return store
    }
  }

export interface EffectSagaRunner<A, E = never, R = never> {
  enhancer: StoreEnhancer<StoreExt>
  switchSaga: (saga: Effect.Effect<A, E, StoreService | R>) => Promise<void>
  start: () => Promise<void>
  stop: () => Promise<void>
}

type CreateEffectSagaRunnerOptions<A, E> = {
  onError?: (exit: Exit.Failure<A, E>) => void
}

export interface CreateEffectSagaRunnerFn {
  <A, E>(
    saga: Effect.Effect<A, E, StoreService>,
    options?: CreateEffectSagaRunnerOptions<A, E>,
  ): Promise<EffectSagaRunner<A, E>>

  <A, E, const Layers extends readonly Layer.Layer<never, unknown>[]>(
    saga: Effect.Effect<
      A,
      E,
      StoreService | NoInfer<Layer.Success<Layers[number]>>
    >,
    options: CreateEffectSagaRunnerOptions<
      A,
      E | Layer.Error<Layers[number]>
    > & {
      extraLayers: Layers
    },
  ): Promise<EffectSagaRunner<A, E, Layer.Success<Layers[number]>>>

  // Tuple inference also handles inline Layer constructors.
  <
    A,
    E,
    Services extends readonly [] | readonly [unknown, ...unknown[]],
    LayerError,
  >(
    saga: Effect.Effect<A, E, StoreService | NoInfer<Services[number]>>,
    options: CreateEffectSagaRunnerOptions<A, E | LayerError> & {
      extraLayers: {
        readonly [Index in keyof Services]: Layer.Layer<
          Services[Index],
          LayerError
        >
      }
    },
  ): Promise<EffectSagaRunner<A, E, Services[number]>>
}
export const createEffectSagaRunner: CreateEffectSagaRunnerFn =
  _createEffectSagaRunner
async function _createEffectSagaRunner<A, E, R, LayerError>(
  saga: Effect.Effect<A, E, StoreService | R>,
  options: CreateEffectSagaRunnerOptions<A, E | LayerError> & {
    extraLayers?: readonly Layer.Layer<R, LayerError>[]
  } = {},
): Promise<EffectSagaRunner<A, E, R>> {
  const storeDefer = defer<ReduxStore & StoreExt>()
  const onError = options.onError ?? defaultRunnerErrorHandler

  type Services = StoreService | R
  type Saga = Effect.Effect<A, E, Services>
  type SagaRuntime = ManagedRuntime.ManagedRuntime<Services, LayerError>
  let running:
    | {
        runtime: SagaRuntime
        fiber: Fiber.Fiber<A, E | LayerError>
      }
    | undefined
  let pending = Promise.resolve()

  const serialize = (operation: () => Promise<void>): Promise<void> => {
    const result = pending.then(operation)
    pending = result.catch(() => {})
    return result
  }

  const runSaga = (runtime: SagaRuntime, saga: Saga): void => {
    const fiber = runtime.runFork(saga)
    const current = { runtime, fiber }
    running = current
    fiber.addObserver(exit => {
      void serialize(async () => {
        if (running !== current) return
        running = undefined
        const result = await Effect.runPromiseExit(runtime.disposeEffect)
        if (Exit.isFailure(result)) defaultRunnerErrorHandler(result)
      })

      if (Exit.isFailure(exit) && !Cause.hasInterruptsOnly(exit.cause)) {
        onError(exit)
      }
    })
  }

  const enhancer = effectSagaEnhancerFactory(store => {
    if (!storeDefer.isPending) {
      throw new Error('[createEffectSagaRunner] store already set')
    }

    storeDefer.resolve(store)
  })

  const stopCurrent = async (): Promise<void> => {
    const previous = running
    running = undefined
    await previous?.runtime.dispose()
  }

  const start = (): Promise<void> =>
    storeDefer.isPending
      ? storeDefer.promise.then(start)
      : serialize(async () => {
          if (running && !running.fiber.pollUnsafe()) return
          await stopCurrent()
          const store = await storeDefer.promise
          const runtime = ManagedRuntime.make(
            Layer.mergeAll(
              makeStoreService(store),
              ...(options.extraLayers ?? []),
            ),
          )
          await Effect.runPromise(
            Effect.onError(runtime.contextEffect, () => runtime.disposeEffect),
          )
          runSaga(runtime, saga)
        })

  const switchSaga = (saga: Saga): Promise<void> =>
    serialize(async () => {
      if (!running || running.fiber.pollUnsafe()) return
      const { runtime, fiber } = running
      await Effect.runPromise(Fiber.interrupt(fiber))
      runSaga(runtime, saga)
    })

  return {
    enhancer,
    start,
    switchSaga,
    stop: () => serialize(stopCurrent),
  }
}

const defaultRunnerErrorHandler = (
  exit: Exit.Failure<unknown, unknown>,
): void => {
  console.groupCollapsed('[effect-saga] Unhandled saga error:')
  console.error(Cause.pretty(exit.cause))
  console.error(exit)
  console.groupEnd()
}

export function combineSagas<
  Sagas extends Effect.Effect<unknown, unknown, unknown>[] = [],
>(
  ...sagas: Sagas
): Effect.All.Return<
  Sagas,
  {
    concurrency: 'unbounded'
  }
> {
  return Effect.all(sagas, {
    concurrency: 'unbounded',
  })
}
