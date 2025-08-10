export function defer<T = void>(): defer.Deferred<T> {
  const result: defer.Deferred<T> = {
    isPending: true,
  } as any

  result.promise = new Promise<T>((_resolve, _reject) => {
    result.resolve = v => {
      result.isPending = false
      _resolve(v)
    }
    result.reject = v => {
      result.isPending = false
      _reject(v)
    }
  })

  return result
}

export namespace defer {
  export interface Deferred<T> {
    isPending: boolean
    promise: Promise<T>
    resolve: (value: T) => void
    reject: (err: any) => void
  }
}
