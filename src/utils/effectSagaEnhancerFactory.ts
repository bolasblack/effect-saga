import { Effect, Fiber, Layer, Runtime } from 'effect'
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

export interface CreateEffectSagaRunnerFn {
  <A, E>(
    saga: Effect.Effect<A, E, StoreService>,
  ): Promise<EffectSagaRunner<A, E>>

  <A, E>(
    saga: Effect.Effect<A, E, StoreService>,
    // eslint-disable-next-line @typescript-eslint/no-empty-object-type
    options: {},
  ): Promise<EffectSagaRunner<A, E>>

  <A, E, Layers extends Layer.Layer<any, any, any>[] = never[]>(
    saga: Effect.Effect<
      A,
      E,
      StoreService | Layer.Layer.Success<Layers[number]>
    >,
    options: {
      extraLayers: Layers
    },
  ): Promise<EffectSagaRunner<A, E, Layer.Layer.Success<Layers[number]>>>
}
export const createEffectSagaRunner: CreateEffectSagaRunnerFn =
  _createEffectSagaRunner
async function _createEffectSagaRunner<
  A,
  E,
  Layers extends Layer.Layer<any, any, any>[] = never[],
>(
  saga: Effect.Effect<A, E, StoreService | Layer.Layer.Success<Layers[number]>>,
  options: {
    extraLayers?: Layers
  } = {},
): Promise<EffectSagaRunner<A, E, Layer.Layer.Success<Layers[number]>>> {
  const storeDefer = defer<ReduxStore & StoreExt>()

  let running: null | {
    runtime: Runtime.Runtime<any>
    fiber: Fiber.Fiber<any, any>
  } = null

  const enhancer = effectSagaEnhancerFactory(store => {
    if (!storeDefer.isPending) {
      throw new Error('[createEffectSagaRunner] store already set')
    }

    storeDefer.resolve(store)
  })

  const start = async (): Promise<void> => {
    const store = await storeDefer.promise

    const runtime = await makeSagaRuntime({
      store,
      extraLayers: options.extraLayers,
    })

    const fiber = Runtime.runFork(runtime, saga as any)

    running = { runtime, fiber }
  }

  const stop = async (): Promise<void> => {
    if (running) {
      await Runtime.runPromise(running.runtime, Fiber.interrupt(running.fiber))
      running = null
    }
  }

  const switchSaga = async (
    saga: Effect.Effect<any, any, any>,
  ): Promise<void> => {
    if (running) {
      await Runtime.runPromise(running.runtime, Fiber.interrupt(running.fiber))
      const fiber = Runtime.runFork(running.runtime, saga)
      running = {
        runtime: running.runtime,
        fiber,
      }
    }
  }

  return {
    enhancer,
    start,
    switchSaga,
    stop,
  }
}

export async function makeSagaRuntime<
  Layers extends Layer.Layer<any, any, any>[],
>(context: {
  store: ReduxStore & StoreExt
  extraLayers?: undefined | Layers
}): Promise<
  Runtime.Runtime<StoreService | Layer.Layer.Context<Layers[number]>>
> {
  const storeLayer = makeStoreService(context.store)

  const appLayer = Layer.mergeAll(storeLayer, ...(context.extraLayers ?? []))

  const runtimeEffect = Layer.toRuntime(appLayer)

  return await Effect.runPromise(Effect.scoped(runtimeEffect) as any)
}

export function combineSagas<Sagas extends Effect.Effect<any, any, any>[] = []>(
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
