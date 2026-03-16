/**
 * Wraps a promise with a timeout.
 *
 * Returns a promise that rejects with a timeout error if the original
 * promise doesn't resolve within the specified milliseconds.
 *
 * @param promise The promise to wrap with timeout
 * @param ms Timeout duration in milliseconds
 * @returns Promise that resolves with the original result or rejects on timeout
 */
export function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timeout: NodeJS.Timeout
  return Promise.race([
    promise.then((result) => {
      clearTimeout(timeout)
      return result
    }),
    new Promise<never>((_, reject) => {
      timeout = setTimeout(() => {
        reject(new Error(`Operation timed out after ${ms}ms`))
      }, ms)
    }),
  ])
}
