/**
 * Creates an AbortController that automatically aborts after a timeout.
 *
 * Uses bind() instead of arrow functions to avoid capturing the surrounding
 * scope in closures. Arrow functions like `() => controller.abort()` capture
 * request bodies and other large objects, preventing GC for the timer lifetime.
 *
 * @param ms Timeout in milliseconds
 * @returns Object with controller, signal, and clearTimeout function
 */
export function abortAfter(ms: number) {
  const controller = new AbortController()
  const id = setTimeout(controller.abort.bind(controller), ms)
  return {
    controller,
    signal: controller.signal,
    clearTimeout: () => globalThis.clearTimeout(id),
  }
}

/**
 * Combines multiple AbortSignals with a timeout.
 *
 * @param ms Timeout in milliseconds
 * @param signals Additional signals to combine
 * @returns Combined signal that aborts on timeout or when any input signal aborts
 */
export function abortAfterAny(ms: number, ...signals: AbortSignal[]) {
  const timeout = abortAfter(ms)
  const signal = AbortSignal.any([timeout.signal, ...signals])
  return {
    signal,
    clearTimeout: timeout.clearTimeout,
  }
}

/**
 * Races a promise against an AbortSignal, rejecting when the signal fires.
 * Properly cleans up the abort listener when the promise settles first,
 * avoiding unhandled rejection issues that occur with naive Promise.race patterns.
 */
export function raceSignal<T>(promise: Promise<T>, signal: AbortSignal, msg = "Aborted"): Promise<T> {
  if (signal.aborted) return Promise.reject(new Error(msg))
  return new Promise<T>((resolve, reject) => {
    const handler = () => reject(new Error(msg))
    signal.addEventListener("abort", handler, { once: true })
    promise.then(
      (v) => {
        signal.removeEventListener("abort", handler)
        resolve(v)
      },
      (e) => {
        signal.removeEventListener("abort", handler)
        reject(e)
      },
    )
  })
}
