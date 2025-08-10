import { createStore } from 'redux'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { subscribeStoreActionEnhancerFactory } from './subscribeStoreActionEnhancerFactory'

describe('subscribeStoreActionEnhancerFactory', () => {
  let enhancer: ReturnType<typeof subscribeStoreActionEnhancerFactory>

  beforeEach(() => {
    enhancer = subscribeStoreActionEnhancerFactory()
  })

  it('should add subscribeAction method to store', () => {
    const reducer = (state = { value: 0 }, action: any): { value: number } => {
      if (action.type === 'INCREMENT') {
        return { value: state.value + 1 }
      }
      return state
    }

    const store = createStore(reducer, enhancer)

    expect(store.subscribeAction).toBeDefined()
    expect(typeof store.subscribeAction).toBe('function')
  })

  it('should notify listeners when actions are dispatched', () => {
    const reducer = (state = { value: 0 }, action: any): { value: number } => {
      if (action.type === 'INCREMENT') {
        return { value: state.value + 1 }
      }
      return state
    }

    const store = createStore(reducer, enhancer)
    const listener = vi.fn()

    store.subscribeAction(listener)

    const action = { type: 'INCREMENT' }
    store.dispatch(action)

    expect(listener).toHaveBeenCalledTimes(1)
    expect(listener).toHaveBeenCalledWith(action, { value: 0 })
  })

  it('should provide state snapshot before action is processed', () => {
    const reducer = (state = { value: 0 }, action: any): { value: number } => {
      if (action.type === 'INCREMENT') {
        return { value: state.value + 1 }
      }
      return state
    }

    const store = createStore(reducer, enhancer)
    const snapshots: any[] = []

    store.subscribeAction((action: any, stateSnapshot: any): void => {
      snapshots.push({ action, stateSnapshot })
    })

    store.dispatch({ type: 'INCREMENT' })
    store.dispatch({ type: 'INCREMENT' })
    store.dispatch({ type: 'INCREMENT' })

    expect(snapshots).toHaveLength(3)
    expect(snapshots[0]).toEqual({
      action: { type: 'INCREMENT' },
      stateSnapshot: { value: 0 },
    })
    expect(snapshots[1]).toEqual({
      action: { type: 'INCREMENT' },
      stateSnapshot: { value: 1 },
    })
    expect(snapshots[2]).toEqual({
      action: { type: 'INCREMENT' },
      stateSnapshot: { value: 2 },
    })
  })

  it('should support multiple listeners', () => {
    const reducer = (state = {}): object => state
    const store = createStore(reducer, enhancer)

    const listener1 = vi.fn()
    const listener2 = vi.fn()
    const listener3 = vi.fn()

    store.subscribeAction(listener1)
    store.subscribeAction(listener2)
    store.subscribeAction(listener3)

    const action = { type: 'TEST' }
    store.dispatch(action)

    expect(listener1).toHaveBeenCalledWith(action, {})
    expect(listener2).toHaveBeenCalledWith(action, {})
    expect(listener3).toHaveBeenCalledWith(action, {})
  })

  it('should support unsubscribing listeners', () => {
    const reducer = (state = {}): object => state
    const store = createStore(reducer, enhancer)

    const listener1 = vi.fn()
    const listener2 = vi.fn()

    const unsubscribe1 = store.subscribeAction(listener1)
    const unsubscribe2 = store.subscribeAction(listener2)

    store.dispatch({ type: 'TEST1' })
    expect(listener1).toHaveBeenCalledTimes(1)
    expect(listener2).toHaveBeenCalledTimes(1)

    unsubscribe1()

    store.dispatch({ type: 'TEST2' })
    expect(listener1).toHaveBeenCalledTimes(1) // Not called again
    expect(listener2).toHaveBeenCalledTimes(2) // Still called

    unsubscribe2()

    store.dispatch({ type: 'TEST3' })
    expect(listener1).toHaveBeenCalledTimes(1) // Not called again
    expect(listener2).toHaveBeenCalledTimes(2) // Not called again
  })

  it('should not affect normal dispatch behavior', () => {
    const reducer = vi.fn((state = { value: 0 }, action: any) => {
      if (action.type === 'INCREMENT') {
        return { value: state.value + 1 }
      }
      return state
    })

    const store = createStore(reducer, enhancer)

    const result1 = store.dispatch({ type: 'INCREMENT' })
    const result2 = store.dispatch({ type: 'INCREMENT' })

    expect(result1).toEqual({ type: 'INCREMENT' })
    expect(result2).toEqual({ type: 'INCREMENT' })
    expect(store.getState()).toEqual({ value: 2 })
    expect(reducer).toHaveBeenCalledTimes(3) // Init + 2 dispatches
  })

  it('should handle errors in listeners gracefully', () => {
    const reducer = (state = {}): object => state
    const store = createStore(reducer, enhancer)

    const goodListener = vi.fn()
    const badListener = vi.fn(() => {
      throw new Error('Listener error')
    })
    const anotherGoodListener = vi.fn()

    store.subscribeAction(goodListener)
    store.subscribeAction(badListener)
    store.subscribeAction(anotherGoodListener)

    // Should not throw
    expect(() => {
      store.dispatch({ type: 'TEST' })
    }).not.toThrow()

    // All listeners should be called despite error
    expect(goodListener).toHaveBeenCalled()
    expect(badListener).toHaveBeenCalled()
    expect(anotherGoodListener).toHaveBeenCalled()
  })
})
