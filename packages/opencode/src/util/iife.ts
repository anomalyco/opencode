/**
 * Immediately Invoked Function Expression (IIFE) helper.
 *
 * Executes the provided function immediately and returns its result.
 * Useful for creating scoped blocks that return values.
 *
 * @param fn The function to execute immediately
 * @returns The result of the function execution
 */
export function iife<T>(fn: () => T) {
  return fn()
}
