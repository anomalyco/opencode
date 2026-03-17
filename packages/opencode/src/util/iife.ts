/**
 * Immediately invokes the given function and returns its result.
 *
 * A simple wrapper for immediately invoked function expressions (IIFE).
 * Useful for creating a scope or avoiding polluting the outer scope.
 *
 * @param fn - The function to invoke immediately
 * @returns The return value of the function
 *
 * @example
 * ```typescript
 * const result = iife(() => {
 *   const temp = computeExpensiveValue()
 *   return temp * 2
 * })
 * ```
 */
export function iife<T>(fn: () => T) {
  return fn()
}
