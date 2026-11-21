import type { Browser } from "@opencode/plugin-browser/rpc"

/** A paused page cannot paint the frame that its dialog or a recovery navigation would unblock. */
export function needsWakeFrame(method: Browser.Method, loaded: boolean, dialog: boolean) {
  const painting: Browser.Method[] = ["snapshot", "find", "wait", "evaluate", "click", "check", "fill", "fill_form", "select", "press", "hover", "drag", "scroll", "screenshot"]

  return loaded && !dialog && painting.includes(method)
}

// Long enough to cover thinking between a snapshot and its follow-up; a forgotten tab doesn't animate indefinitely.
const idleMs = 30_000

export function agentRendering(signal: AbortSignal, throttle: (enabled: boolean) => void) {
  let holds = 0
  let awake = false
  // Whether a frame was waited for since the page woke. A command that needs no frame (`frames`, `console`, `dialog`)
  // wakes the page without one, and the next command that needs one must still wait for it.
  let painted = false
  let paint: Promise<void> | undefined
  let idle: ReturnType<typeof setTimeout> | undefined
  signal.addEventListener("abort", () => clearTimeout(idle), { once: true })

  return {
    hold(onWake?: () => Promise<void>) {
      signal.throwIfAborted()
      clearTimeout(idle)

      if (!awake) throttle(false)
      awake = true
      holds++

      if (onWake && !painted && !paint) {
        const frame = onWake().catch(() => undefined)
        paint = frame
        // A renderer that never paints is not asked again: the command proceeds as it would without a frame.
        void frame.then(() => {
          painted = true

          if (paint === frame) paint = undefined
        })
      }

      return {
        painted: onWake ? paint : undefined,
        [Symbol.dispose]() {
          if (--holds || signal.aborted) return
          idle = setTimeout(() => {
            awake = false
            painted = false
            paint = undefined
            throttle(true)
          }, idleMs)
        },
      }
    },
    // A cross-site commit can replace the renderer while a command or its grace period is active.
    committed() {
      if (awake && !signal.aborted) throttle(false)
    },
  }
}
