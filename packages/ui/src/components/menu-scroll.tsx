import { createResizeObserver } from "@solid-primitives/resize-observer"
import { createSignal, onCleanup, onMount, Show, splitProps, untrack, type ComponentProps, type JSX } from "solid-js"
import { createStore } from "solid-js/store"
import {
  INITIAL_SCROLL_THUMB_STATE,
  overflowChanged,
  SCROLL_IDLE_ELAPSED,
  SCROLL_IDLE_MS,
  SCROLL_THUMB_DISPOSED,
  SCROLLED,
  selectDraggingAxis,
  selectShowVerticalThumb,
  selectThumbScrolling,
  transitionScrollThumb,
  type ScrollThumbEvent,
  type ScrollThumbState,
} from "./scroll-view-machine"
import "./menu-scroll.css"

/**
 * A scroll container for menus, popovers and dialog lists. It hides the native scrollbar and draws the shared thumb
 * over the content, so rows keep equal start and end padding whether or not the list overflows. Touch devices and
 * high-contrast modes keep the native scrollbar.
 */
export function MenuScroll(
  props: Omit<ComponentProps<"div">, "ref" | "onScroll" | "onFocusIn"> & {
    viewportClass?: string
    viewportRef?: (element: HTMLDivElement) => void
    onScroll?: JSX.EventHandler<HTMLDivElement, Event>
  },
) {
  const [local, rest] = splitProps(props, ["class", "children", "viewportClass", "viewportRef", "onScroll"])

  const [geometry, setGeometry] = createStore({ size: 0 })

  const [thumbState, setThumbState] = createSignal<ScrollThumbState>(INITIAL_SCROLL_THUMB_STATE)

  let viewport!: HTMLDivElement

  let content!: HTMLDivElement

  let thumb: HTMLDivElement | undefined

  let idleTimer: ReturnType<typeof setTimeout> | undefined
  let idleDeadline = 0

  const onIdleElapsed = () => {
    idleTimer = undefined
    const remaining = idleDeadline - performance.now()

    if (remaining > 4) {
      idleTimer = setTimeout(onIdleElapsed, remaining)

      return
    }

    dispatch(SCROLL_IDLE_ELAPSED)
  }

  const dispatch = (event: ScrollThumbEvent) => {
    const prev = untrack(thumbState)
    const next = transitionScrollThumb(prev, event)

    if (next.state !== prev) setThumbState(next.state)

    for (const effect of next.effects) {
      if (effect === "release-capture") {
        if (prev.status === "dragging" && thumb?.hasPointerCapture(prev.pointerId))
          thumb.releasePointerCapture(prev.pointerId)
        continue
      }

      if (effect === "reset-idle-timer") {
        // Record the next deadline instead of clearing and recreating a timer on every scroll frame.
        idleDeadline = performance.now() + SCROLL_IDLE_MS

        if (idleTimer === undefined) idleTimer = setTimeout(onIdleElapsed, SCROLL_IDLE_MS)
        continue
      }

      clearTimeout(idleTimer)
      idleTimer = undefined
    }
  }

  // Cached from ResizeObserver so scroll events only read scrollTop and never force layout after child handlers write.
  const metrics = { track: 0, size: 0, max: 0, start: 4, measured: false }

  const position = (scrollTop: number) => {
    const start = 4 + (metrics.max > 0 ? (scrollTop / metrics.max) * (metrics.track - metrics.size) : 0)

    if (metrics.start === start) return
    metrics.start = start

    if (thumb) thumb.style.transform = `translateY(${start}px)`
  }

  const measure = () => {
    const clientHeight = viewport.clientHeight
    const scrollHeight = viewport.scrollHeight
    const scrollTop = viewport.scrollTop
    const track = Math.max(0, clientHeight - 8)
    const size = Math.min(track, Math.max(24, (clientHeight / Math.max(1, scrollHeight)) * track))
    const max = Math.max(0, scrollHeight - clientHeight)

    metrics.track = track
    metrics.size = size
    metrics.max = max
    metrics.measured = true

    const start = 4 + (max > 0 ? (scrollTop / max) * (track - size) : 0)
    metrics.start = start

    if (geometry.size !== size) setGeometry("size", size)

    if (thumb) thumb.style.transform = `translateY(${start}px)`
    dispatch(overflowChanged(max > 0, false))
  }

  const onPointerEnd = (event: PointerEvent) => dispatch({ type: "drag.ended", pointerId: event.pointerId })

  onMount(() => createResizeObserver([viewport, content], measure))

  onCleanup(() => dispatch(SCROLL_THUMB_DISPOSED))

  return (
    <div
      data-component="menu-scroll"
      data-scrolling={selectThumbScrolling(thumbState()) ? "" : undefined}
      data-dragging={selectDraggingAxis(thumbState()) === "vertical" ? "" : undefined}
      class={local.class}
    >
      <div
        data-slot="menu-scroll-viewport"
        {...rest}
        ref={(element) => {
          viewport = element
          local.viewportRef?.(element)
        }}
        data-scrollable
        class={local.viewportClass}
        onScroll={(event) => {
          const top = viewport.scrollTop
          // Child handlers read clean layout before thumb geometry and scroll state write.
          local.onScroll?.(event)

          if (metrics.measured) position(top)

          if (!metrics.measured) measure()
          // Keyboard navigation scrolls without hovering, so the thumb also shows while the list scrolls.
          dispatch(SCROLLED)
        }}
        // Kobalte menus focus items without scrolling and scroll their own content, which no longer overflows here.
        onFocusIn={(event) => {
          if (event.target !== viewport) event.target.scrollIntoView({ block: "nearest", inline: "nearest" })
        }}
      >
        <div ref={content} data-slot="menu-scroll-content">
          {local.children}
        </div>
      </div>
      <Show when={selectShowVerticalThumb(thumbState())}>
        <div
          ref={(element) => {
            thumb = element
            element.style.transform = `translateY(${metrics.start}px)`
          }}
          data-slot="menu-scroll-thumb"
          aria-hidden="true"
          style={{ height: `${geometry.size}px` }}
          onPointerDown={(event) => {
            if (event.button !== 0) return
            event.preventDefault()
            event.stopPropagation()
            dispatch({
              type: "drag.started",
              axis: "vertical",
              pointerId: event.pointerId,
              grabOffset: event.clientY - event.currentTarget.getBoundingClientRect().top,
              rtl: false,
            })

            if (event.isTrusted && selectDraggingAxis(untrack(thumbState)) === "vertical")
              event.currentTarget.setPointerCapture(event.pointerId)
          }}
          onPointerMove={(event) => {
            const drag = untrack(thumbState)

            if (drag.status !== "dragging" || drag.pointerId !== event.pointerId) return

            // A drag whose capture never started or was dropped without a `pointerup` ends at the first move without
            // the button, instead of scrolling under a hovering pointer.
            if (event.isTrusted && (event.buttons & 1) === 0) return onPointerEnd(event)
            const travel = viewport.clientHeight - 8 - geometry.size

            if (travel <= 0) return
            viewport.scrollTop =
              ((event.clientY - viewport.getBoundingClientRect().top - 4 - drag.grabOffset) / travel) *
              (viewport.scrollHeight - viewport.clientHeight)
          }}
          onPointerUp={onPointerEnd}
          onPointerCancel={onPointerEnd}
          onLostPointerCapture={onPointerEnd}
        />
      </Show>
    </div>
  )
}
