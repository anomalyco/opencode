/**
 * Creates a signal/promise pair for async coordination.
 *
 * Provides a way to trigger and wait for events across asynchronous boundaries.
 * The returned trigger function resolves the wait promise.
 *
 * @example
 * ```typescript
 * const { trigger, wait } = signal()
 * setTimeout(() => trigger(), 100)
 * await wait() // Resolves after 100ms
 * ```
 */
export function signal() {
  let resolve: any
  const promise = new Promise((r) => (resolve = r))
  return {
    /**
     * Triggers the signal, resolving the wait promise.
     */
    trigger() {
      return resolve()
    },
    /**
     * Returns the promise that resolves when trigger is called.
     * @returns A promise that resolves when triggered
     */
    wait() {
      return promise
    },
  }
}
