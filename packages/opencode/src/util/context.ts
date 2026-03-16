import { AsyncLocalStorage } from "async_hooks"

/**
 * Provides asynchronous context management using AsyncLocalStorage.
 *
 * This namespace enables creating and managing async contexts that persist
 * through asynchronous operations. Useful for request-scoped data, tracing,
 * and dependency injection in async workflows.
 *
 * @example
 * ```typescript
 * const RequestContext = Context.create<{ userId: string }>("request")
 *
 * RequestContext.provide({ userId: "123" }, async () => {
 *   // Context is available here and in nested async calls
 *   const ctx = RequestContext.use()
 *   console.log(ctx.userId) // "123"
 * })
 * ```
 */
export namespace Context {
  /**
   * Error thrown when attempting to use a context that hasn't been set.
   *
   * This error indicates that `use()` was called outside of a `provide()`
   * block, meaning no context value is available in the current async scope.
   */
  export class NotFound extends Error {
    /**
     * Creates a new NotFound error.
     *
     * @param name - The name of the context that was not found
     */
    constructor(public override readonly name: string) {
      super(`No context found for ${name}`)
    }
  }

  /**
   * Creates a new async context with the specified name.
   *
   * Returns an object with `use()` to retrieve the context value and
   * `provide()` to set the context for a function execution.
   *
   * @param name - A descriptive name for this context (used in error messages)
   * @returns An object with `use()` and `provide()` methods
   * @template T - The type of value stored in this context
   * @example
   * ```typescript
   * const DBContext = Context.create<Database>("database")
   *
   * // Provide context for an async operation
   * await DBContext.provide(db, async () => {
   *   // Access context anywhere in the call stack
   *   const db = DBContext.use()
   *   await db.query("SELECT * FROM users")
   * })
   * ```
   */
  export function create<T>(name: string) {
    const storage = new AsyncLocalStorage<T>()
    return {
      /**
       * Retrieves the current context value.
       *
       * @returns The current context value
       * @throws {NotFound} If called outside of a provide() block
       */
      use() {
        const result = storage.getStore()
        if (!result) {
          throw new NotFound(name)
        }
        return result
      },
      /**
       * Executes a function with the specified context value.
       *
       * The context is available to the function and any async operations
       * it initiates. Context is automatically cleaned up after execution.
       *
       * @param value - The context value to provide
       * @param fn - The function to execute with this context
       * @returns The return value of the function
       * @template R - The return type of the function
       */
      provide<R>(value: T, fn: () => R) {
        return storage.run(value, fn)
      },
    }
  }
}
