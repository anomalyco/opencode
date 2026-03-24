export interface BrowserSetTimeoutOptions {
  signal?: AbortSignal
  ref?: boolean
}

function createAbortError(): Error {
  try {
    return new DOMException("The operation was aborted", "AbortError")
  } catch {
    const error = new Error("The operation was aborted")
    error.name = "AbortError"
    return error
  }
}

export function setTimeout<T = void>(
  delay?: number,
  value?: T,
  options: BrowserSetTimeoutOptions = {},
): Promise<T> {
  const signal = options.signal

  if (signal?.aborted) {
    return Promise.reject(createAbortError())
  }

  return new Promise<T>((resolve, reject) => {
    const timer = globalThis.setTimeout(() => {
      cleanup()
      resolve(value as T)
    }, delay ?? 0)

    const onAbort = () => {
      globalThis.clearTimeout(timer)
      cleanup()
      reject(createAbortError())
    }

    const cleanup = () => {
      signal?.removeEventListener("abort", onAbort)
    }

    signal?.addEventListener("abort", onAbort, { once: true })
  })
}

export default {
  setTimeout,
}
