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

  const [geometry, setGeometry] = createStore({ size: 0, start: 4 })

  const [thumbState, setThumbState] = createSignal<ScrollThumbState>(INITIAL_SCROLL_THUMB_STATE)

  let viewport!: HTMLDivElement

  let content!: HTMLDivElement

  let thumb: HTMLDivElement | undefined

  let idleTimer: ReturnType<typeof setTimeout> | undefined
  let cachedTrack = 0
  let cachedSize = 0
  let cachedMax = 0
  let measured = false
  let pointerFocus = false

  const onIdleElapsed = () => {
    idleTimer = undefined
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

      clearTimeout(idleTimer)
      idleTimer = effect === "reset-idle-timer" ? setTimeout(onIdleElapsed, SCROLL_IDLE_MS) : undefined
    }
  }

  const syncThumbStart = (scrollTop: number) => {
    setGeometry("start", 4 + (cachedMax > 0 ? (scrollTop / cachedMax) * (cachedTrack - cachedSize) : 0))
  }

  const measure = () => {
    const clientHeight = viewport.clientHeight
    const scrollHeight = viewport.scrollHeight
    const track = Math.max(0, clientHeight - 8)
    const size = Math.min(track, Math.max(24, (clientHeight / Math.max(1, scrollHeight)) * track))
    const max = scrollHeight - clientHeight

    cachedTrack = track
    cachedSize = size
    cachedMax = max
    measured = true

    setGeometry("size", size)
    syncThumbStart(viewport.scrollTop)
    dispatch(overflowChanged(max > 0, false))
  }

  const onPointerEnd = (event: PointerEvent) => dispatch({ type: "drag.ended", pointerId: event.pointerId })

  onMount(() => {
    createResizeObserver([viewport, content], measure)

    const onPointer = () => {
      pointerFocus = true
    }

    const onKey = () => {
      pointerFocus = false
    }

    viewport.addEventListener("pointermove", onPointer, { passive: true })
    viewport.addEventListener("pointerdown", onPointer, { passive: true })
    viewport.addEventListener("keydown", onKey)
    onCleanup(() => {
      viewport.removeEventListener("pointermove", onPointer)
      viewport.removeEventListener("pointerdown", onPointer)
      viewport.removeEventListener("keydown", onKey)
    })
  })

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
          // Read before the list's own handler runs: it may write styles, and reading scrollTop after that forces a
          // layout. The thumb and the scrolling state are written last, so that handler reads a clean layout too.
          const top = viewport.scrollTop
          local.onScroll?.(event)

          if (measured) syncThumbStart(top)

          if (!measured) measure()
          // Keyboard navigation scrolls without hovering, so the thumb also shows while the list scrolls.
          dispatch(SCROLLED)
        }}
        // Kobalte menus focus items without scrolling on keyboard navigation, and also focus on pointermove; only reveal
        // non-pointer focus so hovering a clipped row never fights the wheel.
        onFocusIn={(event) => {
          if (!pointerFocus && event.target !== viewport)
            event.target.scrollIntoView({ block: "nearest", inline: "nearest" })
        }}
      >
        <div ref={content} data-slot="menu-scroll-content">
          {local.children}
        </div>
      </div>
      <Show when={selectShowVerticalThumb(thumbState())}>
        <div
          ref={thumb}
          data-slot="menu-scroll-thumb"
          aria-hidden="true"
          style={{ height: `${geometry.size}px`, transform: `translateY(${geometry.start}px)` }}
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
