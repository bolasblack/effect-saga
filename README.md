# effect-saga

A Redux saga implementation using the [Effect](https://effect.website/) library for functional programming. This library provides a powerful and type-safe way to handle side effects in Redux applications using Effect's functional programming primitives.

## Why?

Redux-saga is great, but **Effect is sweet**!

I love redux-saga's elegant patterns, but Effect brings exactly what I've been missing:

- **Error tracking that actually works**
- **Dependency injection**
- **Built-in Fiber & Stream**

So why not combine the best of both worlds?

## Installation

```bash
npm install effect-saga effect@^4.0.6 redux@^5
# or
yarn add effect-saga effect@^4.0.6 redux@^5
# or
pnpm add effect-saga effect@^4.0.6 redux@^5
```

Use TypeScript 5.9 or newer with strict type checking. CommonJS on Node.js requires [`require(esm)`](https://nodejs.org/api/modules.html#loading-ecmascript-modules-using-require). It is enabled by default starting with 20.19 on the Node.js 20 line and 22.12 on the Node.js 22 line.

## Quick Start

```typescript
import { createStore, combineReducers, type UnknownAction } from 'redux'
import { Effect } from 'effect'
import {
  createEffectSagaRunner,
  combineSagas,
  makeActionStream,
  actionPattern,
  put,
  takeEvery,
  takeLatest,
} from 'effect-saga'

// Define your action types
const INCREMENT = 'counter/increment'
const DECREMENT = 'counter/decrement'
const FETCH_DATA = 'data/fetch'

// Define your reducer
const counterReducer = (state = { value: 0 }, action: UnknownAction) => {
  switch (action.type) {
    case INCREMENT:
      return { value: state.value + 1 }
    case DECREMENT:
      return { value: state.value - 1 }
    default:
      return state
  }
}

const rootReducer = combineReducers({
  counter: counterReducer,
})

// Create your saga
const rootSaga = combineSagas(
  // Take every increment action
  takeEvery(makeActionStream(actionPattern(INCREMENT)), ({ action }) =>
    Effect.gen(function* () {
      console.log('Increment action:', action)
      // Dispatch another action
      yield* put({ type: 'counter/logged' })
    }),
  ),

  // Take only the latest fetch request
  takeLatest(makeActionStream(actionPattern(FETCH_DATA)), ({ action }) =>
    Effect.gen(function* () {
      if (!('payload' in action) || typeof action.payload !== 'string') return
      const url = `/api/data/${encodeURIComponent(action.payload)}`
      const response = yield* Effect.tryPromise(signal => fetch(url, { signal }))
      const data = yield* Effect.tryPromise(() => response.json())
      yield* put({ type: 'data/fetchSuccess', payload: data })
    }).pipe(
      Effect.catch(error => put({ type: 'data/fetchError', payload: error.message })),
    ),
  ),
)

// Create the saga runner
const sagaRunner = await createEffectSagaRunner(rootSaga)

// Configure your store with the saga enhancer
const store = createStore(rootReducer, sagaRunner.enhancer)

// Start the saga
await sagaRunner.start()
```

## Core Concepts

### Effects

Effects are declarative descriptions of side effects that are executed by the effect-saga middleware. This library provides several effect creators:

#### `put(action)`

Dispatches an action to the Redux store.

```typescript
yield* put({ type: 'user/updated', payload: userData })
```

#### `select(selector)`

Extracts data from the Redux store state.

```typescript
const userId = yield* select((state: RootState) => state.user.id)
```

#### `take(stream)`

Waits for and returns a single value from a stream.

```typescript
const action = yield* take(makeActionStream(actionPattern('user/login')))
```

### Action Patterns

Action patterns are used to filter actions in streams:

```typescript
// Match any action
const anyPattern = actionPattern()

// Match specific action type
const loginPattern = actionPattern('user/login')

// Match multiple action types
const authPattern = actionPattern(['user/login', 'user/logout'])

// Type-safe pattern
const userPattern = actionPattern<{ type: string; payload: any }>()
```

### Streams

The library provides stream-based APIs for reactive programming:

#### `makeActionStream(pattern)`

Creates a stream of actions matching the pattern.

```typescript
const loginStream = makeActionStream(actionPattern('user/login'))
```

#### `makeStateStream(selector)`

Creates a stream of state changes, emitting only when the selected value changes.

```typescript
const userStream = makeStateStream((state: RootState) => state.user)
```

### Saga Helpers

#### `takeEvery(stream, handler)`

Spawns a new handler for every matching action (concurrent execution).

```typescript
yield* takeEvery(makeActionStream(actionPattern('task/start')), streamValue =>
  Effect.gen(function* () {
    // Handle each task start
    const { action, state, stateSnapshot } = streamValue
    console.log('Task started:', action)
    yield* put({ type: 'task/processing' })
  }),
)
```

#### `takeLatest(stream, handler)`

Cancels any previous handler and runs only the latest (serial execution with cancellation).

```typescript
yield* takeLatest(makeActionStream(actionPattern('search/query')), streamValue =>
  Effect.gen(function* () {
    // Only handle the latest search query
    const { action } = streamValue
    const query = (action as any).payload

    // This will be cancelled if a new search comes in
    yield* Effect.sleep('500 millis') // Debounce

    const results = yield* Effect.tryPromise(() =>
      fetch(`/api/search?q=${query}`).then(r => r.json()),
    )

    yield* put({ type: 'search/results', payload: results })
  }),
)
```

#### `combineSagas(...sagas)`

Runs multiple sagas concurrently. A failure interrupts running siblings and may skip sagas that have yet to start.

```typescript
const rootSaga = combineSagas(userSaga, dataSaga, uiSaga)
```

## Advanced Usage

### Using Layers

You can provide additional Effect layers for dependency injection:

```typescript
import { Context, Effect, Layer } from 'effect'
import { createEffectSagaRunner } from 'effect-saga'

// Define a service
class LoggerService extends Context.Service<
  LoggerService,
  { log: (message: string) => Effect.Effect<void> }
>()('LoggerService') {}

// Create a layer
const loggerLayer = Layer.succeed(LoggerService, {
  log: message => Effect.sync(() => console.log(message)),
})

// Use the service in your saga
const saga = Effect.gen(function* () {
  const logger = yield* LoggerService
  yield* logger.log('Saga started')
})

const sagaRunner = await createEffectSagaRunner(saga, {
  extraLayers: [loggerLayer],
})
```

Provide dependencies of extra layers with `Layer.provide` before passing them to the runner. Scoped layers are shared across `switchSaga` calls and released when the active saga finishes or the runner stops.

### Dynamic Saga Switching

You can dynamically switch sagas at runtime:

```typescript
// Switch to a different saga
await sagaRunner.switchSaga(newRootSaga)

// Stop all sagas
await sagaRunner.stop()
```

### Custom Stream Operations

The library exposes Effect's Stream API for advanced use cases:

```typescript
import { Stream } from 'effect'
import { actionPattern, makeActionStream } from 'effect-saga'

const customStream = makeActionStream(actionPattern()).pipe(
  Stream.filter(({ action }) => action.type === 'task/start'),
  Stream.throttle({ duration: '1 second', units: 1, cost: () => 1 }),
  Stream.map(action => ({
    ...action,
    timestamp: Date.now(),
  })),
)
```

## API Reference

### Core Exports

- `StoreService` - Effect service tag for store access
- `makeStoreService(store)` - Creates a store service layer
- `createEffectSagaRunner(saga, options?)` - Creates a saga runner with Redux enhancer

### Operators

- `put(action)` - Dispatch an action to the Redux store
- `select(selector)` - Select from Redux state
- `take(stream)` - Take one value from a stream
- `takeEvery(stream, handler)` - Handle every matching value (concurrent)
- `takeLatest(stream, handler)` - Handle only latest value (cancels previous)

### Stream Creators

- `makeActionStream(pattern)` - Create filtered action stream
- `makeStateStream(selector)` - Create state change stream

### Saga Helpers

- `combineSagas(...sagas)` - Combine multiple sagas
- `actionPattern()` - Create an action pattern matcher
- `actionPattern(type)` - Match specific action type
- `actionPattern(types[])` - Match multiple action types

### Types

- `Store<S, A, StateExt>` - Extended Redux store type with subscribeAction
- `EffectSagaRunner<A, E, R>` - Saga runner interface
- `ActionPattern<T>` - Action pattern matcher type
- `ActionListener` - Action subscription listener type
- `SubscribeStoreActionFn` - Subscribe to actions function type

### Bonus

- `subscribeStoreActionEnhancerFactory()` - Create action subscription enhancer
- `streamDistinctUntilChanged(stream, isEqual)` - Filter consecutive duplicates

## Testing

Testing sagas is straightforward since they yield declarative effects:

```typescript
import { Effect, Layer } from 'effect'
import { StoreService } from 'effect-saga'
import { testSaga } from './sagas'

describe('MySaga', () => {
  it('should handle actions correctly', async () => {
    // Create a test store service
    const testStore = {
      dispatch: vi.fn(),
      getState: () => ({ user: { id: 1 } }),
      subscribeAction: () => () => {},
    }

    const testLayer = Layer.succeed(StoreService, testStore)

    // Run the saga with test layer
    await Effect.runPromise(
      testSaga.pipe(Effect.provide(testLayer)),
    )

    // Assert on dispatched actions
    expect(testStore.dispatch).toHaveBeenCalledWith({
      type: 'expected/action',
    })
  })
})
```

## Migration from Redux-Saga

If you're migrating from redux-saga, here's a comparison of common patterns:

| redux-saga                         | effect-saga                                              |
| ---------------------------------- | -------------------------------------------------------- |
| `yield take('ACTION')`             | `yield* take(makeActionStream(actionPattern('ACTION')))` |
| `yield put(action)`                | `yield* put(action)`                                     |
| `yield select(selector)`           | `yield* select(selector)`                                |
| `yield takeEvery('ACTION', saga)`  | `yield* takeEvery(stream, handler)`                      |
| `yield takeLatest('ACTION', saga)` | `yield* takeLatest(stream, handler)`                     |
| `yield call(fn, ...args)`          | `yield* Effect.tryPromise(() => fn(...args))`            |
| `yield fork(saga)`                 | `yield* Effect.forkChild(saga)`                          |
| `yield all([...])`                 | `yield* Effect.all([...])`                               |

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

### Effect source reference

`repos/effect` contains the upstream source and tests for the Effect version pinned by this project. Contributors and coding agents can trace behavior such as fiber cancellation and layer cleanup against the implementation we actually run. [Effect's recommendation for keeping dependency source nearby](https://effect.website/blog/the-one-weird-git-trick-that-makes-coding-agents-more-effect-ive/)

Project code imports the installed `effect` package. The reference subtree stays outside the build and npm package. [AGENTS.md](AGENTS.md) describes how to refresh it when the Effect version changes.

## License

MIT

## Acknowledgments

This library is inspired by [redux-saga](https://redux-saga.js.org/) and built on top of the excellent [Effect](https://effect.website/) library.
