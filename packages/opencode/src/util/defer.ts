/**
 * Creates a disposable resource that calls the given function on cleanup.
 *
 * Supports both sync and async disposal via Symbol.dispose and Symbol.asyncDispose.
 * Useful for creating resources that can be used with `using` declarations.
 *
 * @param fn - The function to call when the resource is disposed
 * @returns An object with Symbol.dispose and Symbol.asyncDispose methods
 *
 * @example
 * ```typescript
 * const resource = defer(() => console.log("cleanup"))
 * using _ = resource
 * // "cleanup" printed when scope exits
 * ```
 */
export function defer<T extends () => void | Promise<void>>(
  fn: T,
): T extends () => Promise<void> ? { [Symbol.asyncDispose]: () => Promise<void> } : { [Symbol.dispose]: () => void } {
  return {
    [Symbol.dispose]() {
      fn()
    },
    [Symbol.asyncDispose]() {
      return Promise.resolve(fn())
    },
  } as any
}
