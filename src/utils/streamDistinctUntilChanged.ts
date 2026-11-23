import { Option, Stream } from 'effect'
import { dual } from 'effect/Function'

export const streamDistinctUntilChanged = dual<
  <A>(
    isEqual: (a: A, b: A) => boolean,
  ) => <E, R>(stream: Stream.Stream<A, E, R>) => Stream.Stream<A, E, R>,
  <A, E, R>(
    stream: Stream.Stream<A, E, R>,
    isEqual: (a: A, b: A) => boolean,
  ) => Stream.Stream<A, E, R>
>(
  2,
  <A, E, R>(
    stream: Stream.Stream<A, E, R>,
    isEqual: (a: A, b: A) => boolean,
  ): Stream.Stream<A, E, R> =>
    Stream.mapAccum(stream, Option.none<A>, (previous, value) => [
      Option.some(value),
      Option.isSome(previous) && isEqual(previous.value, value) ? [] : [value],
    ]),
)
