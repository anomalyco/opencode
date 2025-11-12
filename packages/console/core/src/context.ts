import { AsyncLocalStorage } from "node:async_hooks"

export namespace Context {
  export class NotFound extends Error {}

  export function create<T>() {
    const storage = new AsyncLocalStorage<T>()
    return {
      use() {
        const result = storage.getStore()
        if (!result) {
          throw new NotFound()
        }
        return result
      },
      provide<R>(value: T, fn: () => R) {
        return storage.run(value, fn)
      },
    }
  }
}
