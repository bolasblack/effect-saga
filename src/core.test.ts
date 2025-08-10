import { Effect, Stream } from 'effect'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  Store,
  StoreService,
  actionPattern,
  makeStateStream,
  makeStoreService,
  put,
  select,
  take,
  takeEvery,
  takeLatest,
} from './core'

// Helper to create action creators
const createAction = <P = void>(
  type: string,
): ((payload: P) => { type: string; payload: P }) & { type: string } => {
  const actionCreator = (payload: P): { type: string; payload: P } => ({
    type,
    payload,
  })
  actionCreator.type = type
  return actionCreator
}

describe('effect-saga core', () => {
  type State = { counter: number; user?: { id: number; name: string } }
  const initialState: State = { counter: 0, user: { id: 1, name: 'John' } }
  let mockStore: Store<State>

  beforeEach(() => {
    mockStore = {
      [Symbol.observable]: vi.fn(),
      dispatch: vi.fn(),
      getState: vi.fn(() => initialState),
      subscribe: vi.fn(),
      replaceReducer: vi.fn(),
      subscribeAction: vi.fn(() => {
        // Return unsubscribe function
        return () => {}
      }),
    }
  })

  describe('StoreService', () => {
    it('should create a store service layer', async () => {
      const layer = makeStoreService(mockStore)

      const program = Effect.gen(function* () {
        const store = yield* StoreService
        expect(store).toBeDefined()
        expect(store.dispatch).toBeDefined()
        expect(store.getState).toBeDefined()
        expect(store.subscribeAction).toBeDefined()
      })

      await Effect.runPromise(program.pipe(Effect.provide(layer)))
    })

    it('should dispatch actions through the service', async () => {
      const layer = makeStoreService(mockStore)
      const action = { type: 'TEST_ACTION', payload: 'test' }

      const program = Effect.gen(function* () {
        const store = yield* StoreService
        store.dispatch(action)
      })

      await Effect.runPromise(program.pipe(Effect.provide(layer)))
      expect(mockStore.dispatch).toHaveBeenCalledWith(action)
    })
  })

  describe('actionPattern', () => {
    const testAction = createAction<string>('test/action')

    it('should match any action when no type specified', () => {
      const pattern = actionPattern()
      expect(pattern({ type: 'any' })).toBe(true)
      expect(pattern({ type: 'another' })).toBe(true)
    })

    it('should match specific action type', () => {
      const pattern = actionPattern('test/action')
      expect(pattern({ type: 'test/action' })).toBe(true)
      expect(pattern({ type: 'other/action' })).toBe(false)
    })

    it('should match multiple action types', () => {
      const pattern = actionPattern(['action1', 'action2'])
      expect(pattern({ type: 'action1' })).toBe(true)
      expect(pattern({ type: 'action2' })).toBe(true)
      expect(pattern({ type: 'action3' })).toBe(false)
    })

    it('should handle non-action objects', () => {
      const pattern = actionPattern('test')
      expect(pattern(null)).toBe(false)
      expect(pattern(undefined)).toBe(false)
      expect(pattern('string')).toBe(false)
      expect(pattern(123)).toBe(false)
      expect(pattern({})).toBe(false)
    })

    it('should work with Redux Toolkit actions', () => {
      const pattern = actionPattern<ReturnType<typeof testAction>>(
        testAction.type,
      )
      const action = testAction('payload')
      expect(pattern(action)).toBe(true)
      expect(pattern({ type: 'other' })).toBe(false)
    })
  })

  describe('makeStateStream', () => {
    it('should emit initial state and deduplicate', async () => {
      const layer = makeStoreService(mockStore)

      const program = Effect.gen(function* () {
        const stream = makeStateStream((state: State) => state.counter)
        const firstValue = yield* take(stream)
        expect(firstValue).toBe(0)
      })

      await Effect.runPromise(program.pipe(Effect.provide(layer)))
    })

    it('should only emit when selected value changes', async () => {
      let listeners: any[] = []
      const customStore = {
        ...mockStore,
        subscribeAction: vi.fn(listener => {
          listeners.push(listener)
          return () => {
            listeners = listeners.filter(l => l !== listener)
          }
        }),
      }

      const layer = makeStoreService(customStore)

      const program = Effect.gen(function* () {
        const stream = makeStateStream((state: State) => state.counter)
        const values: number[] = []

        // Start collecting values in background
        const fiber = yield* Effect.fork(
          stream.pipe(
            Stream.take(3),
            Stream.runForEach(value => Effect.sync(() => values.push(value))),
          ),
        )

        // Simulate state changes with delays to ensure proper processing
        yield* Effect.sync(() => {
          // Same value - should not emit
          customStore.getState = () => ({ counter: 0 })
          listeners.forEach(l => l({ type: 'action1' }, {}))
        })

        yield* Effect.sleep('10 millis')

        yield* Effect.sync(() => {
          // New value - should emit
          customStore.getState = () => ({ counter: 1 })
          listeners.forEach(l => l({ type: 'action2' }, {}))
        })

        yield* Effect.sleep('10 millis')

        yield* Effect.sync(() => {
          // Same value - should not emit
          customStore.getState = () => ({ counter: 1 })
          listeners.forEach(l => l({ type: 'action3' }, {}))
        })

        yield* Effect.sleep('10 millis')

        yield* Effect.sync(() => {
          // New value - should emit
          customStore.getState = () => ({ counter: 2 })
          listeners.forEach(l => l({ type: 'action4' }, {}))
        })

        yield* Effect.sleep('10 millis')

        yield* fiber.await
        expect(values).toEqual([0, 1, 2])
      })

      await Effect.runPromise(program.pipe(Effect.provide(layer)))
    })
  })

  describe('put effect', () => {
    it('should dispatch an action', async () => {
      const layer = makeStoreService(mockStore)
      const action = { type: 'TEST_PUT', payload: 42 }

      const program = put(action)

      await Effect.runPromise(program.pipe(Effect.provide(layer)))
      expect(mockStore.dispatch).toHaveBeenCalledWith(action)
    })
  })

  describe('select effect', () => {
    it('should select from state', async () => {
      const layer = makeStoreService(mockStore)

      const program = Effect.gen(function* () {
        const userId = yield* select((state: any) => state.user.id)
        const userName = yield* select((state: any) => state.user.name)

        expect(userId).toBe(1)
        expect(userName).toBe('John')
      })

      await Effect.runPromise(program.pipe(Effect.provide(layer)))
    })
  })

  describe('take effect', () => {
    it('should take first value from stream', async () => {
      const layer = makeStoreService(mockStore)

      const program = Effect.gen(function* () {
        // Create a simple stream with known values
        const stream = Stream.make(1, 2, 3)
        const value = yield* take(stream)
        expect(value).toBe(1)
      })

      await Effect.runPromise(program.pipe(Effect.provide(layer)))
    })
  })

  describe('takeEvery', () => {
    it('should handle every action sequentially', async () => {
      const layer = makeStoreService(mockStore)
      const results: number[] = []

      const program = Effect.gen(function* () {
        const stream = Stream.make(1, 2, 3)

        yield* takeEvery(stream, value => {
          results.push(value)
          return Effect.succeed(value * 2)
        })
      })

      await Effect.runPromise(program.pipe(Effect.provide(layer)))
      expect(results).toEqual([1, 2, 3])
    })
  })

  describe('takeLatest', () => {
    it('should cancel previous handlers when new value arrives', async () => {
      const layer = makeStoreService(mockStore)
      const started: number[] = []
      const completed: number[] = []

      const program = Effect.gen(function* () {
        const stream = Stream.make(1, 2, 3).pipe(
          Stream.flatMap(value =>
            Stream.fromEffect(
              Effect.succeed(value).pipe(Effect.delay('10 millis')),
            ),
          ),
        )

        yield* takeLatest(stream, value =>
          Effect.gen(function* () {
            started.push(value)
            yield* Effect.sleep('50 millis')
            completed.push(value)
            return value
          }),
        )
      })

      await Effect.runPromise(program.pipe(Effect.provide(layer)))

      // All should start
      expect(started.length).toBeGreaterThan(0)
      // Only the last should complete due to switching
      expect(completed).toEqual([3])
    })
  })
})
