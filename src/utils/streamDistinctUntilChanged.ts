import { Stream } from 'effect'
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
  ): Stream.Stream<A, E, R> => {
    const initial = Symbol('initial')

    const _isEqual = (a: typeof initial | A, b: A): boolean => {
      if (a === initial) return false
      return isEqual(a, b)
    }

    type ScanResult = {
      isEqual: boolean
      lastValue: typeof initial | A
    }

    return stream.pipe(
      Stream.scan<ScanResult, A>(
        { isEqual: false, lastValue: initial },
        (a, b) => ({
          isEqual: _isEqual(a.lastValue, b),
          lastValue: b,
        }),
      ),
      Stream.filter(res => !res.isEqual && res.lastValue !== initial),
      Stream.map(({ lastValue }) => lastValue as A),
    )
  },
)
