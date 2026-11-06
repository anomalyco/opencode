import { createSignal, onCleanup, splitProps, untrack, type JSX } from "solid-js"
import {
  INITIAL_RESIZE_HANDLE_STATE,
  RESIZE_DRAG_CANCELLED,
  RESIZE_HANDLE_DISPOSED,
  resizeSign,
  resizeSize,
  selectResizeHandleActive,
  transitionResizeHandle,
  type ResizeHandleEvent,
  type ResizeHandleState,
} from "./resize-handle-machine"

export interface ResizeHandleProps extends Omit<JSX.HTMLAttributes<HTMLDivElement>, "onResize"> {
  direction: "horizontal" | "vertical"
  edge?: "start" | "end"
  size: number
  min: number
  max: number
  onResize: (size: number) => void
  onCollapse?: () => void
  /** Called while dragging when size crosses `collapseThreshold`. */
  onCollapseChange?: (collapsed: boolean) => void
  collapseThreshold?: number
  /** Called with true on the first move of a drag and with false when it ends; a click without moving calls neither. */
  onDraggingChange?: (dragging: boolean) => void
}

export function ResizeHandle(props: ResizeHandleProps) {
  const [local, rest] = splitProps(props, [
    "direction",
    "edge",
    "size",
    "min",
    "max",
    "onResize",
    "onCollapse",
    "onCollapseChange",
    "collapseThreshold",
    "onDraggingChange",
    "class",
    "classList",
  ])

  const [dragState, setDragState] = createSignal<ResizeHandleState>(INITIAL_RESIZE_HANDLE_STATE)
  const edge = () => local.edge ?? (local.direction === "vertical" ? "start" : "end")
  const moved = { type: "pointer.moved" as const, pointerId: 0, pos: 0 }
  let handle: HTMLDivElement | undefined
  let body: { userSelect: string; overflow: string; cursor: string } | undefined

  const dispatch = (event: ResizeHandleEvent) => {
    const prev = untrack(dragState)
    const next = transitionResizeHandle(prev, event)

    if (next.state !== prev) setDragState(next.state)

    for (const effect of next.effects) {
      switch (effect) {
        case "lock-body":
          if (next.state.status !== "pressed") break
          body = {
            userSelect: document.body.style.userSelect,
            overflow: document.body.style.overflow,
            cursor: document.body.style.cursor,
          }
          document.body.style.userSelect = "none"
          document.body.style.overflow = "hidden"
          document.body.style.cursor = next.state.session.direction === "horizontal" ? "col-resize" : "row-resize"
          window.addEventListener("pointermove", onPointerMove)
          window.addEventListener("pointerup", onPointerUp)
          window.addEventListener("pointercancel", onPointerCancel)
          window.addEventListener("blur", onBlur)
          break
        case "unlock-body":
          window.removeEventListener("pointermove", onPointerMove)
          window.removeEventListener("pointerup", onPointerUp)
          window.removeEventListener("pointercancel", onPointerCancel)
          window.removeEventListener("blur", onBlur)

          if (prev.status === "pressed" || prev.status === "dragging") {
            if (handle?.hasPointerCapture(prev.session.pointerId)) handle.releasePointerCapture(prev.session.pointerId)
          }

          if (body) Object.assign(document.body.style, body)
          body = undefined
          break
        case "dragging-true":
        case "dragging-false":
          local.onDraggingChange?.(effect === "dragging-true")
          break
        case "collapse-true":
        case "collapse-false":
          local.onCollapseChange?.(effect === "collapse-true")
          break
        case "collapse-commit":
          local.onCollapse?.()
          break
        case "resize":
          if (next.state.status === "dragging") local.onResize(resizeSize(next.state.session, moved.pos))
          break
      }
    }
  }

  const onPointerMove = (e: PointerEvent) => {
    const state = untrack(dragState)

    if (state.status !== "pressed" && state.status !== "dragging") return
    moved.pointerId = e.pointerId
    moved.pos = state.session.direction === "horizontal" ? e.clientX : e.clientY
    dispatch(moved)
  }

  const onPointerUp = (e: PointerEvent) => dispatch({ type: "pointer.up", pointerId: e.pointerId })
  const onPointerCancel = (e: PointerEvent) => dispatch({ type: "drag.cancelled", pointerId: e.pointerId })
  const onBlur = () => dispatch(RESIZE_DRAG_CANCELLED)

  onCleanup(() => dispatch(RESIZE_HANDLE_DISPOSED))

  return (
    <div
      {...rest}
      ref={handle}
      data-component="resize-handle"
      data-direction={local.direction}
      data-edge={edge()}
      data-dragging={selectResizeHandleActive(dragState()) ? "" : undefined}
      classList={{
        ...local.classList,
        [local.class ?? ""]: !!local.class,
      }}
      // Bubbles on purpose: wrappers start their own resize state from this `pointerdown`.
      onPointerDown={(e) => {
        const rtl = local.direction === "horizontal" && getComputedStyle(e.currentTarget).direction === "rtl"

        dispatch({
          type: "pointer.down",
          button: e.button,
          ctrlKey: e.ctrlKey,
          detail: e.detail,
          session: {
            pointerId: e.pointerId,
            direction: local.direction,
            sign: resizeSign(local.direction, edge(), rtl),
            startPos: local.direction === "horizontal" ? e.clientX : e.clientY,
            startSize: local.size,
            min: local.min,
            max: local.max,
            threshold: local.collapseThreshold ?? 0,
          },
        })

        // The handle holds the pointer until the button comes up, so hover stays on it rather than following the
        // pointer across the panels it resizes, each crossing restyling their contents.
        if (e.isTrusted && untrack(dragState).status === "pressed") e.currentTarget.setPointerCapture(e.pointerId)
      }}
      // Keeps focus and text selection where they are; canceling `pointerdown` would not.
      onMouseDown={(e) => {
        if (selectResizeHandleActive(untrack(dragState))) e.preventDefault()
      }}
      onLostPointerCapture={(e) => dispatch({ type: "drag.cancelled", pointerId: e.pointerId })}
    />
  )
}
