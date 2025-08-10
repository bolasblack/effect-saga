import { describe, expect, it } from 'vitest'
import { defer } from './defer'

describe('defer', () => {
  it('should create a deferred promise', () => {
    const deferred = defer<string>()

    expect(deferred).toBeDefined()
    expect(deferred.promise).toBeInstanceOf(Promise)
    expect(deferred.resolve).toBeInstanceOf(Function)
    expect(deferred.reject).toBeInstanceOf(Function)
    expect(deferred.isPending).toBe(true)
  })

  it('should resolve the promise', async () => {
    const deferred = defer<string>()

    expect(deferred.isPending).toBe(true)

    const resultPromise = deferred.promise
    deferred.resolve('success')

    const result = await resultPromise
    expect(result).toBe('success')
    expect(deferred.isPending).toBe(false)
  })

  it('should reject the promise', async () => {
    const deferred = defer<string>()

    expect(deferred.isPending).toBe(true)

    const resultPromise = deferred.promise.catch(err => err)
    deferred.reject('error')

    const result = await resultPromise
    expect(result).toBe('error')
    expect(deferred.isPending).toBe(false)
  })

  it('should work with void type', async () => {
    const deferred = defer()

    const resultPromise = deferred.promise
    deferred.resolve(undefined)

    const result = await resultPromise
    expect(result).toBe(undefined)
    expect(deferred.isPending).toBe(false)
  })

  it('should work with complex types', async () => {
    interface User {
      id: number
      name: string
    }

    const deferred = defer<User>()

    const user: User = { id: 1, name: 'John' }
    const resultPromise = deferred.promise
    deferred.resolve(user)

    const result = await resultPromise
    expect(result).toEqual(user)
    expect(deferred.isPending).toBe(false)
  })

  it('should handle multiple deferrals independently', async () => {
    const deferred1 = defer<number>()
    const deferred2 = defer<number>()

    deferred1.resolve(1)
    deferred2.resolve(2)

    const result1 = await deferred1.promise
    const result2 = await deferred2.promise

    expect(result1).toBe(1)
    expect(result2).toBe(2)
    expect(deferred1.isPending).toBe(false)
    expect(deferred2.isPending).toBe(false)
  })

  it('should allow promise to be awaited before resolution', async () => {
    const deferred = defer<string>()

    const waitPromise = (async () => {
      const result = await deferred.promise
      return `Got: ${result}`
    })()

    // Resolve after promise is already being awaited
    setTimeout(() => deferred.resolve('delayed'), 10)

    const result = await waitPromise
    expect(result).toBe('Got: delayed')
  })

  it('should handle rejection with Error objects', async () => {
    const deferred = defer<string>()
    const error = new Error('Something went wrong')

    const resultPromise = deferred.promise.catch(err => err)
    deferred.reject(error)

    const result = await resultPromise
    expect(result).toBe(error)
    expect(result.message).toBe('Something went wrong')
    expect(deferred.isPending).toBe(false)
  })
})
