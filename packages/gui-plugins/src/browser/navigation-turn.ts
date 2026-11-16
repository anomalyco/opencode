/** A page owns at most one not-yet-issued navigation. Once issued, Chromium owns cancellation and history. */
export function navigationTurn(
  wait: ((url: string, signal: AbortSignal) => Promise<void> | undefined) | undefined,
  started: (url: string) => void,
  stopped: () => void,
) {
  let pending: AbortController | undefined
  let spinning = false

  const cancel = () => {
    pending?.abort()
    pending = undefined

    if (spinning) stopped()
    spinning = false
  }

  return {
    cancel,
    begin(signal: AbortSignal) {
      cancel()
      const mine = new AbortController()
      pending = mine
      const lifetime = AbortSignal.any([mine.signal, signal])

      return async (url: string, issue: () => void | Promise<void>) => {
        if (mine.signal.aborted) return
        lifetime.throwIfAborted()
        const waiting = wait?.(url, lifetime)

        if (waiting) {
          // Let the pane take ownership before publishing the initial restore's spinner.
          await Promise.resolve()

          if (!lifetime.aborted) {
            spinning = true
            started(url)
          }

          await waiting.catch((cause: unknown) => {
            if (mine.signal.aborted) return
            cancel()
            throw cause
          })
        }

        if (mine.signal.aborted) return
        lifetime.throwIfAborted()
        pending = undefined
        spinning = false
        await issue()
      }
    },
  }
}
