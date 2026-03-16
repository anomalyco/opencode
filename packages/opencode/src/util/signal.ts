/**
 * Creates a simple signal/trigger mechanism.
 *
 * Returns an object with trigger and wait methods for one-time
 * notification patterns. Useful for coordinating async operations.
 *
 * @returns Object with trigger function and wait promise
 */
export function signal() {
  let resolve: any
  const promise = new Promise((r) => (resolve = r))
  return {
    trigger() {
      return resolve()
    },
    wait() {
      return promise
    },
  }
}
