/**
 * `AbortSignal.any` for browsers without it (Safari before 17.4): a signal that aborts with the reason of the first of
 * `signals` to abort.
 */
export function anySignal(signals: Iterable<AbortSignal>) {
  const controller = new AbortController()
  const sources = [...signals]
  const aborted = sources.find((signal) => signal.aborted)

  if (aborted) {
    controller.abort(aborted.reason)

    return controller.signal
  }

  const listeners = sources.map((signal) => {
    const abort = () => {
      listeners.forEach((listener) => listener.signal.removeEventListener("abort", listener.abort))
      controller.abort(signal.reason)
    }

    signal.addEventListener("abort", abort, { once: true })

    return { signal, abort }
  })

  return controller.signal
}
