import { AsyncLocalStorage } from "async_hooks"

/**
 * Async context management namespace.
 *
 * Provides a way to create async-local storage contexts that can be
 * accessed across async call chains without explicit parameter passing.
 *
 * @example
 * ```typescript
 * const db = Context.create<Database>("db")
 * db.provide(connection, () => {
 *   // db.use() returns connection here
 * })
 * ```
 */
export namespace Context {
  /**
   * Error thrown when accessing a context that has not been provided.
   */
  export class NotFound extends Error {
    constructor(public override readonly name: string) {
      super(`No context found for ${name}`)
    }
  }

  /**
   * Creates a new async context.
   *
   * @param name - The name of the context (used in error messages)
   * @returns An object with use() and provide() methods
   */
  export function create<T>(name: string) {
    const storage = new AsyncLocalStorage<T>()
    return {
      /**
       * Gets the current context value.
       * @throws NotFound if no context has been provided
       * @returns The current context value
       */
      use() {
        const result = storage.getStore()
        if (!result) {
          throw new NotFound(name)
        }
        return result
      },
      /**
       * Provides a context value for the duration of the callback.
       * @param value - The value to provide
       * @param fn - The callback function to run with the context
       * @returns The result of the callback
       */
      provide<R>(value: T, fn: () => R) {
        return storage.run(value, fn)
      },
    }
  }
}
