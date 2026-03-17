/**
 * Wraps a promise with a timeout.
 *
 * Races the given promise against a timeout. If the timeout wins,
 * the promise is rejected with a timeout error message.
 *
 * @param promise - The promise to wrap with a timeout
 * @param ms - The timeout duration in milliseconds
 * @returns A promise that rejects if the timeout is exceeded
 * @throws Error when the operation times out
 *
 * @example
 * ```typescript
 * const result = await withTimeout(fetchData(), 5000)
 * // Throws "Operation timed out after 5000ms" if fetch takes longer than 5s
 * ```
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
