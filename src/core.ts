import { Action, Store as ReduxStore, UnknownAction } from 'redux'
import { Chunk, Context, Effect, Layer, Sink, Stream, StreamEmit } from 'effect'
import { streamDistinctUntilChanged } from './utils/streamDistinctUntilChanged'
import { SubscribeStoreActionFn } from './utils/subscribeStoreActionEnhancerFactory'

export type Store<
  S = any,
  A extends Action = UnknownAction,
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-constraint
  StateExt extends unknown = unknown,
> = ReduxStore<S, A, StateExt> & {
  subscribeAction: SubscribeStoreActionFn
}

// Service tags for dependency injection
export class StoreService extends Context.Tag('StoreService')<
  StoreService,
  {
    readonly dispatch: (action: UnknownAction) => void
    readonly getState: () => ReturnType<Store['getState']>
    readonly subscribeAction: (
      listener: (action: UnknownAction, stateSnapshot: unknown) => void,
    ) => () => void
  }
>() {}

export const makeStoreService = (store: Store): Layer.Layer<StoreService> =>
  Layer.succeed(
    StoreService,
    StoreService.of({
      dispatch: action => store.dispatch(action),
      getState: () => store.getState(),
      subscribeAction: listener => store.subscribeAction(listener),
    }),
  )

const storeActionStream = Stream.asyncPush(
  (
    emit: StreamEmit.EmitOpsPush<
      never,
      {
        action: UnknownAction
        stateSnapshot: unknown
        state: unknown
      }
    >,
  ) =>
    Effect.acquireRelease(
      Effect.gen(function* () {
        const store = yield* StoreService

        return store.subscribeAction((action, stateSnapshot) => {
          void emit.single({ action, stateSnapshot, state: store.getState() })
        })
      }),
      unsubscribe => Effect.sync(() => unsubscribe()),
    ),
)

export interface ActionPattern<T extends Action = Action> {
  (action: unknown): action is T
}

export function actionPattern<T extends Action>(): ActionPattern<T>
export function actionPattern<T extends Action>(
  type: T['type'] | T['type'][],
): ActionPattern<T>
export function actionPattern<T extends Action>(
  type?: T['type'] | T['type'][],
): ActionPattern<T> {
  return (action): action is T => {
    if (!action || typeof action !== 'object' || !('type' in action)) {
      return false
    }

    if (type == null) return true

    const types = Array.isArray(type) ? type : [type]
    return types.includes(action.type as T['type'])
  }
}

export function makeActionStream<T extends Action>(
  pattern: ActionPattern<T>,
): Stream.Stream<
  { action: T; stateSnapshot: unknown; state: unknown },
  never,
  StoreService
> {
  return storeActionStream.pipe(
    Stream.filter((a): a is typeof a & { action: T } => pattern(a.action)),
  )
}

export function makeStateStream<S, T>(
  selector: (state: S) => T,
): Stream.Stream<T, never, StoreService> {
  return Stream.merge(
    Stream.fromEffect(
      Effect.gen(function* () {
        const { getState } = yield* StoreService
        return getState()
      }),
    ),
    storeActionStream.pipe(Stream.map(a => a.state)),
  ).pipe(
    Stream.map(a => selector(a)),
    streamDistinctUntilChanged((a, b) => a === b),
  )
}

export function take<A, E, R>(
  stream: Stream.Stream<A, E, R>,
): Effect.Effect<A, E, R> {
  return stream.pipe(
    Stream.take(1),
    Stream.runCollect,
    Effect.map(chunk => Chunk.unsafeGet(chunk, 0)),
  )
}

export const takeEvery = Effect.fn('takeEvery')(function* <
  AInput,
  AOutput,
  E,
  R,
>(
  stream: Stream.Stream<AInput, E, R>,
  handler: (value: AInput) => Effect.Effect<AOutput, E, R>,
) {
  yield* stream.pipe(
    Stream.flatMap(a => handler(a), {
      concurrency: 1,
    }),
    Stream.run(Sink.drain),
  )
})

export const takeLatest = Effect.fn('takeLatest')(function* <
  AInput,
  AOutput,
  E,
  R,
>(
  stream: Stream.Stream<AInput, E, R>,
  handler: (value: AInput) => Effect.Effect<AOutput, E, R>,
) {
  yield* stream.pipe(
    Stream.flatMap(a => handler(a), {
      concurrency: 1,
      switch: true,
    }),
    Stream.run(Sink.drain),
  )
})

export const put = Effect.fn('put')(function* <A extends Action>(action: A) {
  const { dispatch } = yield* StoreService
  dispatch(action)
})

export const select = Effect.fn('select')(function* <S, T>(
  selector: (state: S) => T,
) {
  const { getState } = yield* StoreService
  return selector(getState())
})
