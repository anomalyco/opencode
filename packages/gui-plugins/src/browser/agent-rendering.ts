// Long enough to cover thinking between a snapshot and its follow-up; a forgotten tab doesn't animate indefinitely.
const idleMs = 30_000

export function agentRendering(signal: AbortSignal, throttle: (enabled: boolean) => void, after = scheduleIdle) {
  let holds = 0
  let awake = false
  let cancel: (() => void) | undefined
  signal.addEventListener("abort", () => cancel?.(), { once: true })

  return {
    hold() {
      signal.throwIfAborted()
      cancel?.()

      if (!awake) throttle(false)
      awake = true
      holds++

      return {
        [Symbol.dispose]() {
          if (--holds || signal.aborted) return
          cancel = after(idleMs, () => {
            awake = false
            throttle(true)
          })
        },
      }
    },
    // A cross-site commit can replace the renderer while a command or its grace period is active.
    committed() {
      if (awake && !signal.aborted) throttle(false)
    },
  }
}

function scheduleIdle(ms: number, run: () => void) {
  const timer = setTimeout(run, ms)

  return () => clearTimeout(timer)
}
