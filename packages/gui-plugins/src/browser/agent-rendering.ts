import type { Browser } from "@opencode/plugin-browser/rpc"

/** A paused page cannot paint the frame that its dialog or a recovery navigation would unblock. */
export function needsWakeFrame(method: Browser.Method, loaded: boolean, dialog: boolean) {
  const painting: Browser.Method[] = ["snapshot", "find", "wait", "evaluate", "click", "check", "fill", "fill_form", "select", "press", "hover", "drag", "scroll", "screenshot"]

  return loaded && !dialog && painting.includes(method)
}

// Long enough to cover thinking between a snapshot and its follow-up; a forgotten tab doesn't animate indefinitely.
const idleMs = 30_000

export function agentRendering(signal: AbortSignal, throttle: (enabled: boolean) => void, after = scheduleIdle) {
  let holds = 0
  let awake = false
  let paint: Promise<void> | undefined
  let cancel: (() => void) | undefined
  signal.addEventListener("abort", () => cancel?.(), { once: true })

  return {
    hold(onWake?: () => Promise<void>) {
      signal.throwIfAborted()
      cancel?.()

      if (!awake) {
        throttle(false)
        paint = onWake?.().catch(() => undefined)
        void paint?.then(() => { paint = undefined })
      }

      awake = true
      holds++

      return {
        painted: onWake ? paint : undefined,
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
