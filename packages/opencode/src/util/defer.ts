/**
 * Creates a disposable resource wrapper for cleanup functions.
 *
 * Wraps a function to make it compatible with JavaScript's explicit resource management
 * (using/dispose pattern). Supports both sync and async cleanup functions.
 *
 * @param fn The cleanup function to wrap
 * @returns An object with Symbol.dispose and Symbol.asyncDispose for use with using keyword
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
