import type { SelectedLineRange } from "@pierre/diffs"
import { createMemo, createSignal, onCleanup, Show, untrack } from "solid-js"
import { Portal } from "solid-js/web"
import { makeEventListener } from "@solid-primitives/event-listener"
import { createMediaQuery } from "@solid-primitives/media"
import { createResizeObserver } from "@solid-primitives/resize-observer"
import { Button } from "@opencode/ui/button"
import { useI18n } from "@opencode/ui/context/i18n"
import {
  createCommentSelectionState,
  selectCommentSelectionToolbar,
  transitionCommentSelection,
  type CommentSelectionEffect,
  type CommentSelectionEvent,
  type CommentSelectionSample,
} from "../pierre/comment-selection-machine"

const RELEASED: CommentSelectionEvent = Object.freeze({ type: "pointer.released" })

const CHANGED: CommentSelectionEvent = Object.freeze({ type: "selection.changed" })

const MOVED: CommentSelectionEvent = Object.freeze({ type: "layout.changed" })

/** Offers to comment on text selected in a file or diff viewer, like the timeline's Quote button. */
export function FileCommentSelection(props: {
  wrapper: HTMLElement
  sample: () => CommentSelectionSample | undefined
  onComment: (range: SelectedLineRange) => void
}) {
  const i18n = useI18n()
  const [state, setState] = createSignal(createCommentSelectionState())
  let element: HTMLElement | undefined
  let settleTimer: ReturnType<typeof setTimeout> | undefined
  let placeFrame: number | undefined

  const run = (effect: CommentSelectionEffect) => {
    if (effect.type === "schedule-settle") {
      clearTimeout(settleTimer)
      settleTimer = setTimeout(() => {
        settleTimer = undefined
        dispatch({ type: "settle.sampled", attempt: effect.attempt, sample: props.sample() })
      }, effect.delayMs)

      return
    }

    if (effect.type === "cancel-settle") {
      clearTimeout(settleTimer)
      settleTimer = undefined

      return
    }

    if (effect.type === "schedule-place") {
      if (placeFrame !== undefined) cancelAnimationFrame(placeFrame)
      placeFrame = requestAnimationFrame(() => {
        placeFrame = undefined
        dispatch({ type: "place.sampled", attempt: effect.attempt, sample: props.sample() })
      })

      return
    }

    if (effect.type === "cancel-place") {
      if (placeFrame !== undefined) cancelAnimationFrame(placeFrame)
      placeFrame = undefined

      return
    }

    if (effect.type === "clear-selection") return window.getSelection()?.removeAllRanges()

    props.onComment(effect.range)
  }

  const dispatch = (event: CommentSelectionEvent) =>
    untrack(() => {
      const step = transitionCommentSelection(state(), event)

      if (step.state !== state()) setState(step.state)
      step.effects.forEach(run)
    })

  // Touch screens show their own menu over the selection.
  const docked = createMediaQuery("(hover: none)")
  const toolbar = createMemo(() => selectCommentSelectionToolbar(state(), docked()))

  const inside = (target: EventTarget | null) => target instanceof Node && !!element?.contains(target)

  makeEventListener(document, "pointerdown", (event) => {
    if (inside(event.target)) return
    dispatch({ type: "pointer.down", button: event.button, inside: event.composedPath().includes(props.wrapper) })
  })
  // A cancelled touch, a long-press or Ctrl+click menu, or leaving the window can end a press without `pointerup`.
  makeEventListener(document, "pointerup", () => dispatch(RELEASED))
  makeEventListener(document, "pointercancel", () => dispatch(RELEASED))
  makeEventListener(document, "contextmenu", () => dispatch(RELEASED))
  makeEventListener(window, "blur", () => dispatch(RELEASED))
  makeEventListener(document, "selectionchange", () => dispatch(CHANGED))
  makeEventListener(document, "keydown", (event) => {
    if (event.key === "Escape" && !event.defaultPrevented) dispatch({ type: "escape" })
  })
  makeEventListener(document, "scroll", () => dispatch(MOVED), { capture: true, passive: true })
  makeEventListener(window, "resize", () => dispatch(MOVED))
  createResizeObserver(
    () => props.wrapper,
    () => dispatch(MOVED),
  )

  onCleanup(() => dispatch({ type: "disposed" }))

  return (
    <Show when={toolbar()}>
      {(view) => (
        <Portal>
          <div
            ref={(value) => {
              element = value
              createResizeObserver(value, () =>
                dispatch({ type: "toolbar.measured", size: { width: value.offsetWidth, height: value.offsetHeight } }),
              )
              onCleanup(() => {
                element = undefined
              })
            }}
            data-component="file-comment-selection"
            data-prevent-autofocus
            role="toolbar"
            aria-label={i18n.t("ui.lineComment.actions")}
            class="fixed z-50 flex items-center gap-0.5 rounded-[8px] p-0.5 shadow-[var(--v2-elevation-raised)]"
            style={{
              top: `${view().place.top}px`,
              left: `${view().place.left}px`,
              visibility: view().measured ? undefined : "hidden",
            }}
            onMouseDown={(event) => event.preventDefault()}
          >
            <Button size="small" variant="ghost" icon="comment" onClick={() => dispatch({ type: "comment.added" })}>
              {i18n.t("ui.lineComment.add")}
            </Button>
          </div>
        </Portal>
      )}
    </Show>
  )
}
