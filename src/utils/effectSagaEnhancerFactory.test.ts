import { Action, combineReducers, createStore } from 'redux'
import { Context, Deferred, Effect, Exit, Fiber, Layer } from 'effect'
import { describe, expect, it, vi } from 'vitest'
import {
  actionPattern,
  makeActionStream,
  makeStoreService,
  put,
  select,
  take,
} from '../core'
import { defer } from '../helpers/defer'
import { sleep } from '../helpers/promiseHelpers'
import {
  combineSagas,
  createEffectSagaRunner,
} from './effectSagaEnhancerFactory'
import { subscribeStoreActionEnhancerFactory } from './subscribeStoreActionEnhancerFactory'

describe('createEffectSagaRunner', () => {
  it('should create a saga runner with enhancer', async () => {
    const saga = Effect.succeed('test')
    const runner = await createEffectSagaRunner(saga)

    expect(runner).toBeDefined()
    expect(runner.enhancer).toBeDefined()
    expect(runner.start).toBeDefined()
    expect(runner.stop).toBeDefined()
    expect(runner.switchSaga).toBeDefined()
  })

  it('should support extra layers', async () => {
    class TestService extends Context.Service<
      TestService,
      { getValue: () => number }
    >()('TestService') {}

    const Multiplier = Context.Service<number>('Multiplier')

    interface SetValueAction extends Action {
      type: 'test/setValue'
      payload: number
    }

    const saga = Effect.gen(function* () {
      const service = yield* TestService
      const multiplier = yield* Multiplier
      const value = service.getValue() * multiplier
      const action: SetValueAction = { type: 'test/setValue', payload: value }
      yield* put(action)
    })

    const runner = await createEffectSagaRunner(saga, {
      extraLayers: [
        Layer.succeed(TestService, { getValue: () => 21 }),
        Layer.succeed(Multiplier, 2),
      ],
    })

    interface TestState {
      value: number
    }

    const testReducer = (
      state: TestState = { value: 0 },
      action: Action,
    ): TestState => {
      if (action.type === 'test/setValue' && 'payload' in action) {
        return { value: (action as SetValueAction).payload }
      }
      return state
    }

    const rootReducer = combineReducers({
      test: testReducer,
    })

    const store = createStore(rootReducer, runner.enhancer)

    await runner.start()

    // Give saga time to execute
    await sleep(100)

    expect(store.getState().test.value).toBe(42)

    await runner.stop()
  })

  it('should integrate with Redux store', async () => {
    const testSlice = {
      name: 'test',
      initialState: { value: 0 },
      reducers: {
        increment: (state: any) => {
          state.value += 1
        },
      },
    }

    const saga = Effect.gen(function* () {
      yield* put({ type: 'test/increment' })
      const value = yield* select((state: any) => state.test.value)
      expect(value).toBe(1)
    })

    const runner = await createEffectSagaRunner(saga)

    const testReducer = (
      state = testSlice.initialState,
      action: Action,
    ): typeof testSlice.initialState => {
      if (action.type === 'test/increment') {
        return { ...state, value: state.value + 1 }
      }
      return state
    }

    const rootReducer = combineReducers({
      test: testReducer,
    })

    const store = createStore(rootReducer, runner.enhancer)

    await runner.start()

    // Give saga time to execute
    await sleep(100)

    expect(store.getState().test.value).toBe(1)

    await runner.stop()
  })

  it('should call onError when saga fails', async () => {
    const errorSignal = vi.fn()
    const saga = Effect.fail('boom')

    const runner = await createEffectSagaRunner(saga, {
      onError: errorSignal,
    })

    createStore((state = {}) => state, runner.enhancer)

    await runner.start()

    expect(errorSignal).toHaveBeenCalledWith(Exit.fail('boom'))

    await runner.stop()
  })

  it('keeps scoped layers open across a switch and releases them after the saga stops', async () => {
    const events: string[] = []
    const layer = Layer.effectDiscard(
      Effect.acquireRelease(
        Effect.sync(() => events.push('open')),
        () => Effect.sync(() => events.push('close')),
      ),
    )
    const saga = (name: string): Effect.Effect<never> =>
      Effect.sync(() => events.push(`start ${name}`)).pipe(
        Effect.andThen(Effect.never),
        Effect.ensuring(Effect.sync(() => events.push(`stop ${name}`))),
      )
    const onError = vi.fn()
    const runner = await createEffectSagaRunner(saga('first'), {
      extraLayers: [layer],
      onError,
    })
    createStore((state = {}) => state, runner.enhancer)

    await Promise.all([runner.start(), runner.start()])
    await Promise.all([runner.switchSaga(saga('second')), runner.stop()])

    expect(events).toEqual([
      'open',
      'start first',
      'stop first',
      'start second',
      'stop second',
      'close',
    ])
    expect(onError).not.toHaveBeenCalled()
  })

  it('releases scoped layers when the saga finishes on its own', async () => {
    const released = defer()
    const layer = Layer.effectDiscard(
      Effect.addFinalizer(() => Effect.sync(() => released.resolve())),
    )
    const runner = await createEffectSagaRunner(Effect.void, {
      extraLayers: [layer],
    })
    createStore((state = {}) => state, runner.enhancer)

    await runner.start()
    await released.promise
  })

  it('releases partially built layers and allows a retry after startup fails', async () => {
    const released = vi.fn()
    let attempts = 0
    const layer = Layer.effectDiscard(
      Effect.gen(function* () {
        yield* Effect.addFinalizer(() => Effect.sync(released))
        if (attempts++ === 0) return yield* Effect.fail('startup failed')
      }),
    )
    const runner = await createEffectSagaRunner(Effect.never, {
      extraLayers: [layer],
    })
    createStore((state = {}) => state, runner.enhancer)

    await expect(runner.start()).rejects.toBe('startup failed')
    expect(released).toHaveBeenCalledOnce()

    await runner.start()
    await runner.stop()
    expect(released).toHaveBeenCalledTimes(2)
  })
})

describe('createEffectSagaRunner', () => {
  describe('switchSaga', () => {
    it('should support switching sagas', async () => {
      let saga1Ran = false
      let saga2Ran = false

      const saga1 = Effect.gen(function* () {
        yield* Effect.sleep('50 millis')
        saga1Ran = true
      })

      const saga2 = Effect.gen(function* () {
        saga2Ran = true
      })

      const runner = await createEffectSagaRunner(saga1)

      createStore((state = {}) => state, runner.enhancer)

      await runner.start()

      // Switch before saga1 completes
      await sleep(10)
      await runner.switchSaga(saga2)

      // Wait for saga2 to complete
      await sleep(100)

      expect(saga1Ran).toBe(false) // Interrupted
      expect(saga2Ran).toBe(true)

      await runner.stop()
    })
  })
})

describe('combineSagas', () => {
  it('should run multiple sagas concurrently', async () => {
    const results: string[] = []

    const saga1 = Effect.sync(() => results.push('saga1'))
    const saga2 = Effect.gen(function* () {
      results.push('saga2')
      const stream = makeActionStream(actionPattern('test/setValue'))
      yield* take(stream)
    })
    const saga3 = Effect.sync(() => results.push('saga3'))

    const combined = combineSagas(saga1, saga2, saga3)
    const enhancer = subscribeStoreActionEnhancerFactory()
    const store = createStore((state = {}) => state, enhancer)
    const fiber = Effect.runFork(
      combined.pipe(Effect.provide(makeStoreService(store))),
    )

    await sleep(100)
    await Effect.runPromise(Fiber.interrupt(fiber))

    expect(results).toContain('saga1')
    expect(results).toContain('saga2')
    expect(results).toContain('saga3')
    expect(results.length).toBe(3)
  })

  it('fails with the saga error and interrupts a running sibling', async () => {
    const started = Deferred.makeUnsafe<void>()
    const interrupted = vi.fn()
    const waiting = Deferred.succeed(started, undefined).pipe(
      Effect.andThen(Effect.never),
      Effect.onInterrupt(() => Effect.sync(interrupted)),
    )
    const failing = Deferred.await(started).pipe(
      Effect.andThen(Effect.fail('error')),
    )

    await expect(
      Effect.runPromise(combineSagas(waiting, failing)),
    ).rejects.toBe('error')
    expect(interrupted).toHaveBeenCalledOnce()
  })
})
