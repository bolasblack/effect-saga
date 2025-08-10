import { StoreEnhancer, UnknownAction } from 'redux'

export type ActionListener = (
  action: UnknownAction,
  stateSnapshot: unknown,
) => void

export type SubscribeStoreActionFn = (listener: ActionListener) => () => void

export const subscribeStoreActionEnhancerFactory =
  (): StoreEnhancer<{
    subscribeAction: SubscribeStoreActionFn
  }> =>
  next => {
    return (reducer, preloadedState) => {
      let listeners: ActionListener[] = []

      const store = next(reducer, preloadedState)

      return {
        ...store,
        dispatch: action => {
          const stateSnapshot = store.getState()
          const res = store.dispatch(action)
          listeners.forEach(listener => {
            try {
              listener(action, stateSnapshot)
            } catch (error) {
              // Silently catch listener errors to prevent them from breaking dispatch
              console.error('Error in action listener:', error)
            }
          })
          return res
        },
        subscribeAction: listener => {
          listeners.push(listener)

          return () => {
            listeners = listeners.filter(l => l !== listener)
          }
        },
      }
    }
  }
