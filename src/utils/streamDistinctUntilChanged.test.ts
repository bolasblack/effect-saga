import { Chunk, Effect, Stream } from 'effect'
import { describe, expect, it } from 'vitest'
import { streamDistinctUntilChanged } from './streamDistinctUntilChanged'

describe('streamDistinctUntilChanged', () => {
  it('should filter out consecutive duplicate values', async () => {
    const input = [1, 1, 2, 2, 2, 3, 3, 1, 1, 4]
    const expected = [1, 2, 3, 1, 4]

    const result = await Stream.fromIterable(input)
      .pipe(
        streamDistinctUntilChanged((a, b) => a === b),
        Stream.runCollect,
        Effect.map(chunk => Chunk.toArray(chunk)),
      )
      .pipe(Effect.runPromise)

    expect(result).toEqual(expected)
  })

  it('should work with custom equality function', async () => {
    const input = [
      { id: 1, value: 'a' },
      { id: 1, value: 'b' },
      { id: 2, value: 'c' },
      { id: 2, value: 'd' },
      { id: 3, value: 'e' },
    ]

    const expected = [
      { id: 1, value: 'a' },
      { id: 2, value: 'c' },
      { id: 3, value: 'e' },
    ]

    const result = await Stream.fromIterable(input)
      .pipe(
        streamDistinctUntilChanged((a, b) => a.id === b.id),
        Stream.runCollect,
        Effect.map(chunk => Chunk.toArray(chunk)),
      )
      .pipe(Effect.runPromise)

    expect(result).toEqual(expected)
  })

  it('should emit all values if none are equal', async () => {
    const input = [1, 2, 3, 4, 5]

    const result = await Stream.fromIterable(input)
      .pipe(
        streamDistinctUntilChanged((a, b) => a === b),
        Stream.runCollect,
        Effect.map(chunk => Chunk.toArray(chunk)),
      )
      .pipe(Effect.runPromise)

    expect(result).toEqual(input)
  })

  it('should handle empty stream', async () => {
    const result = await Stream.empty
      .pipe(
        streamDistinctUntilChanged((a, b) => a === b),
        Stream.runCollect,
        Effect.map(chunk => Chunk.toArray(chunk)),
      )
      .pipe(Effect.runPromise)

    expect(result).toEqual([])
  })

  it('should handle single value stream', async () => {
    const result = await Stream.make(42)
      .pipe(
        streamDistinctUntilChanged((a, b) => a === b),
        Stream.runCollect,
        Effect.map(chunk => Chunk.toArray(chunk)),
      )
      .pipe(Effect.runPromise)

    expect(result).toEqual([42])
  })

  it('should work with complex equality checks', async () => {
    const input = ['hello', 'HELLO', 'world', 'WORLD', 'World']
    const expected = ['hello', 'world']

    const result = await Stream.fromIterable(input)
      .pipe(
        streamDistinctUntilChanged(
          (a, b) => a.toLowerCase() === b.toLowerCase(),
        ),
        Stream.runCollect,
        Effect.map(chunk => Chunk.toArray(chunk)),
      )
      .pipe(Effect.runPromise)

    expect(result).toEqual(expected)
  })

  it('should support curried usage', async () => {
    const distinctNumbers = streamDistinctUntilChanged<number>(
      (a, b) => a === b,
    )

    const result1 = await Stream.make(1, 1, 2, 2, 3)
      .pipe(
        distinctNumbers,
        Stream.runCollect,
        Effect.map(chunk => Chunk.toArray(chunk)),
      )
      .pipe(Effect.runPromise)

    const result2 = await Stream.make(5, 5, 6, 6, 7)
      .pipe(
        distinctNumbers,
        Stream.runCollect,
        Effect.map(chunk => Chunk.toArray(chunk)),
      )
      .pipe(Effect.runPromise)

    expect(result1).toEqual([1, 2, 3])
    expect(result2).toEqual([5, 6, 7])
  })
})
