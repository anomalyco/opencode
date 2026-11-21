import { createEffect, createSignal, onCleanup, untrack, type Accessor } from "solid-js"
import {
  INITIAL_REVIEW_FOCUS_STATE,
  REVIEW_FOCUS_TIMEOUT_MS,
  transitionReviewFocus,
  type ReviewFocusEffect,
  type ReviewFocusEvent,
} from "./review-focus-machine"

type ReviewFocusTarget = { file: string; id: string }

// Browser resources of the current reveal; the phase itself lives in the machine.
type RevealHandles = {
  frame?: number
  ackFrame?: number
  timer?: ReturnType<typeof setTimeout>
  observer?: MutationObserver
}

type ReviewFocusDriverInput = {
  focusedComment: Accessor<ReviewFocusTarget | null | undefined>
  isAvailable: (focus: ReviewFocusTarget) => boolean
  /** The element the comments render into; the driver watches it for the comment to appear. */
  root: () => HTMLElement | undefined
  /** The rendered, visible comment, if it is there yet. */
  findComment: (file: string, commentId: string) => HTMLElement | undefined
  /** Where to scroll while the comment is not rendered yet, such as its file's placeholder. */
  findFallback?: (file: string) => HTMLElement | undefined
  scrollTo: (target: HTMLElement) => void
  onOpenComment: (file: string, commentId: string) => void
  onExpandFile?: (file: string) => void
  onAcknowledge: VoidFunction
}

// Reveals a parent's focused comment: waits for it to render (DOM mutations, `poke`), scrolls to it, and clears
// the parent's request once it is shown, unavailable or timed out.
export function createReviewFocusDriver(input: ReviewFocusDriverInput) {
  const [focusState, setFocusState] = createSignal(INITIAL_REVIEW_FOCUS_STATE)

  const handles: RevealHandles = {}

  const dispatch = (event: ReviewFocusEvent) => {
    const step = transitionReviewFocus(untrack(focusState), event)
    setFocusState(step.state)
    step.effects.forEach(run)
  }

  const run = (effect: ReviewFocusEffect) => {
    if (effect.type === "cancel-reveal") {
      if (handles.frame !== undefined) cancelAnimationFrame(handles.frame)

      if (handles.ackFrame !== undefined) cancelAnimationFrame(handles.ackFrame)

      if (handles.timer !== undefined) clearTimeout(handles.timer)
      handles.observer?.disconnect()
      handles.frame = undefined
      handles.ackFrame = undefined
      handles.timer = undefined
      handles.observer = undefined

      return
    }

    if (effect.type === "open-comment") return input.onOpenComment(effect.file, effect.commentId)

    if (effect.type === "expand-file") return input.onExpandFile?.(effect.file)

    if (effect.type === "reveal") {
      handles.timer = setTimeout(
        () => dispatch({ type: "reveal.timed-out", attempt: effect.attempt }),
        REVIEW_FOCUS_TIMEOUT_MS,
      )
      schedule()

      return
    }

    if (!effect.deferred) return acknowledge(effect.attempt)
    // An unavailable target is known inside the effect that read the request, so clear it on the next frame.
    handles.ackFrame = requestAnimationFrame(() => {
      handles.ackFrame = undefined
      acknowledge(effect.attempt)
    })
  }

  const acknowledge = (attempt: number) => {
    const current = untrack(focusState)

    if (current.status !== "settled" || current.attempt !== attempt) return
    input.onAcknowledge()
  }

  const schedule = () => {
    if (handles.frame !== undefined) return
    handles.frame = requestAnimationFrame(check)
  }

  const check = () => {
    handles.frame = undefined
    const current = untrack(focusState)

    if (current.status !== "revealing") return
    const root = input.root()

    if (!root) return
    const comment = input.findComment(current.file, current.commentId)

    if (comment) {
      input.scrollTo(comment)
      dispatch({ type: "reveal.succeeded", attempt: current.attempt })

      return
    }

    const fallback = input.findFallback?.(current.file)

    if (fallback) input.scrollTo(fallback)

    if (handles.observer) return
    handles.observer = new MutationObserver(schedule)
    handles.observer.observe(root, { childList: true, subtree: true })
  }

  createEffect(() => {
    const focus = input.focusedComment()

    untrack(() => {
      if (!focus) return dispatch({ type: "focus.cleared" })
      dispatch({ type: "focus.requested", file: focus.file, commentId: focus.id, available: input.isAvailable(focus) })
    })
  })

  onCleanup(() => dispatch({ type: "disposed" }))

  return {
    state: focusState,
    /** Checks again for the comment, for example after the diff rendered. */
    poke: () => {
      if (untrack(focusState).status === "revealing") schedule()
    },
  }
}
