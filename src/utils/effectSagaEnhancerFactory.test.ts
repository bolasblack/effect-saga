import { Action, combineReducers, createStore } from 'redux'
import { Context, Effect, Exit, Fiber, Layer, Runtime } from 'effect'
import { describe, expect, it, vi } from 'vitest'
import { actionPattern, makeActionStream, put, select, take } from '../core'
import { sleep } from '../helpers/promiseHelpers'
import {
  combineSagas,
  createEffectSagaRunner,
  makeSagaRuntime,
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
    class TestService extends Context.Tag('TestService')<
      TestService,
      { getValue: () => number }
    >() {}

    const testLayer = Layer.succeed(TestService, {
      getValue: () => 42,
    })

    interface SetValueAction extends Action {
      type: 'test/setValue'
      payload: number
    }

    const saga = Effect.gen(function* () {
      const service = yield* TestService
      const value = service.getValue()
      const action: SetValueAction = { type: 'test/setValue', payload: value }
      yield* put(action)
    })

    const runner = await createEffectSagaRunner(saga, {
      extraLayers: [testLayer],
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

    expect(Exit.isFailure(errorSignal.mock.calls[0][0])).toBe(true)

    await runner.stop()
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
    const runtime = await makeSagaRuntime({
      store: createStore((state = {}) => state, enhancer),
    })
    const fiber = Runtime.runFork(runtime, combined)

    await sleep(100)
    await Runtime.runPromise(runtime, Fiber.interrupt(fiber))

    expect(results).toContain('saga1')
    expect(results).toContain('saga2')
    expect(results).toContain('saga3')
    expect(results.length).toBe(3)
  })

  it('should handle errors in individual sagas', async () => {
    const results: string[] = []

    const saga1 = Effect.sync(() => results.push('saga1'))
    const saga2 = Effect.fail('error')
    const saga3 = Effect.sync(() => results.push('saga3'))

    const combined = combineSagas(saga1, saga2, saga3)
    const enhancer = subscribeStoreActionEnhancerFactory()
    const runtime = await makeSagaRuntime({
      store: createStore((state = {}) => state, enhancer),
    })

    await expect(Runtime.runPromise(runtime, combined)).rejects.toThrow('error')

    expect(results).toContain('saga1')
    expect(results).toContain('saga3')
  })
})
