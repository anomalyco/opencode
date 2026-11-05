import { createMemo, createSignal, onCleanup, untrack } from "solid-js"
import {
  INITIAL_COPY_FEEDBACK_STATE,
  transitionCopyFeedback,
  viewCopyFeedback,
  type CopyFeedbackEffect,
  type CopyFeedbackEvent,
} from "./copy-machine"

// `navigator.clipboard` exists only in secure contexts, so plain-HTTP LAN origins copy through a selected textarea.
export async function writeClipboard(text: string): Promise<boolean> {
  const written = await navigator.clipboard?.writeText(text).then(
    () => true,
    () => false,
  )

  if (written) return true
  // The textarea sits beside the focused element so a focus trap, such as an open menu's, keeps its selection.
  const active = document.activeElement instanceof HTMLElement ? document.activeElement : undefined
  const host = active && active !== document.body ? (active.parentElement ?? document.body) : document.body
  const textarea = document.createElement("textarea")
  textarea.value = text
  textarea.setAttribute("readonly", "")
  textarea.setAttribute("aria-hidden", "true")
  textarea.tabIndex = -1
  textarea.style.position = "fixed"
  textarea.style.opacity = "0"
  textarea.style.pointerEvents = "none"
  host.appendChild(textarea)
  textarea.select()
  const copied = document.execCommand("copy")
  textarea.remove()
  active?.focus({ preventScroll: true })

  return copied
}

/** "Copied" feedback for one copy button. Owner cleanup clears its reset timer and drops a write still in flight. */
export function createCopyFeedback() {
  const [state, setState] = createSignal(INITIAL_COPY_FEEDBACK_STATE)
  let timer: ReturnType<typeof setTimeout> | undefined

  const dispatch = (event: CopyFeedbackEvent) => {
    const next = transitionCopyFeedback(untrack(state), event)

    if (next.state !== untrack(state)) setState(next.state)
    next.effects.forEach(run)
  }

  const run = (effect: CopyFeedbackEffect) => {
    if (effect.type === "clear-reset") {
      clearTimeout(timer)
      timer = undefined

      return
    }

    if (effect.type === "schedule-reset") {
      timer = setTimeout(() => dispatch({ type: "reset.due", attempt: effect.attempt }), effect.delayMs)

      return
    }

    void writeClipboard(effect.text).then(
      (written) => dispatch({ type: written ? "copy.succeeded" : "copy.failed", attempt: effect.attempt }),
      () => dispatch({ type: "copy.failed", attempt: effect.attempt }),
    )
  }

  onCleanup(() => dispatch({ type: "disposed" }))
  const view = createMemo(() => viewCopyFeedback(state()))

  return {
    copied: () => view().copied,
    copy: (text: string) => dispatch({ type: "copy.requested", text }),
  }
}
