export interface TimeoutOptions {
  signal?: AbortSignal
}

export function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  label?: string,
  opts: TimeoutOptions = {},
): Promise<T> {
  if (opts.signal?.aborted) {
    return Promise.reject(opts.signal.reason ?? new DOMException("Aborted", "AbortError"))
  }

  return new Promise<T>((resolve, reject) => {
    const onAbort = () => {
      cleanup()
      reject(opts.signal?.reason ?? new DOMException("Aborted", "AbortError"))
    }
    const timer = setTimeout(() => {
      cleanup()
      reject(new Error(label ?? `Operation timed out after ${ms}ms`))
    }, ms)
    if (opts.signal) {
      opts.signal.addEventListener("abort", onAbort, { once: true })
    }
    promise.then(
      (v) => {
        cleanup()
        resolve(v)
      },
      (e) => {
        cleanup()
        reject(e)
      },
    )

    function cleanup() {
      clearTimeout(timer)
      opts.signal?.removeEventListener("abort", onAbort)
    }
  })
}
