import {
  createEffect,
  createSignal,
  mergeProps,
  on,
  onCleanup,
  onMount,
  Show,
  splitProps,
  untrack,
  type ComponentProps,
  type JSX,
} from "solid-js"
import { Portal } from "solid-js/web"
import { createResizeObserver } from "@solid-primitives/resize-observer"
import { createStore } from "solid-js/store"
import { useI18n } from "../context/i18n"
import {
  HOVER_ENTERED,
  HOVER_LEFT,
  INITIAL_SCROLL_THUMB_STATE,
  overflowChanged,
  SCROLL_IDLE_ELAPSED,
  SCROLL_IDLE_MS,
  SCROLL_THUMB_DISPOSED,
  SCROLLED,
  selectDraggingAxis,
  selectShowHorizontalThumb,
  selectShowVerticalThumb,
  selectThumbVisible,
  transitionScrollThumb,
  type ScrollAxis,
  type ScrollThumbEvent,
  type ScrollThumbState,
} from "./scroll-view-machine"

export type ScrollViewThumbVisibility = "hover" | "scroll"

export interface ScrollViewProps extends ComponentProps<"div"> {
  viewportRef?: (el: HTMLDivElement) => void
  orientation?: "vertical" | "horizontal" | "both"
  /**
   * `hover`: show while hovered or scrolling. `scroll`: show only while scrolling.
   *
   * In most cases, scrolling a container = hovering over it, so this change has no effect.
   * This is a special case to account for the home page scroll, where scrolling a container != hovering over it
   * */
  thumbVisibility?: ScrollViewThumbVisibility
  /** Mount the thumb into an external track. Scroll metrics still come from this ScrollView. */
  thumbContainer?: HTMLElement
  /** Element whose hover reveals the thumb. Defaults to the ScrollView root when unset. */
  thumbHoverTarget?: HTMLElement
  /** Reconcile native scroll geometry before keyboard or scrollbar navigation reads it. */
  onBeforeScroll?: () => void
  /** Offset/extent correction for a virtualized vertical scrollbar. */
  verticalScrollAdjustment?: number
}

export const scrollKey = (event: Pick<KeyboardEvent, "key" | "altKey" | "ctrlKey" | "metaKey" | "shiftKey">) => {
  if (event.altKey || event.ctrlKey || event.metaKey) return

  if (event.shiftKey && event.key !== " ") return

  switch (event.key) {
    case "PageDown":
      return "page-down"
    case "PageUp":
      return "page-up"
    case "Home":
      return "home"
    case "End":
      return "end"
    case "ArrowUp":
      return "up"
    case "ArrowDown":
      return "down"
    case " ":
      return event.shiftKey ? "page-up" : "page-down"
  }
}

export function canScrollKey(element: HTMLElement, key: NonNullable<ReturnType<typeof scrollKey>>) {
  const up = key === "up" || key === "page-up" || key === "home"

  return up ? element.scrollTop > 0 : element.scrollTop + element.clientHeight < element.scrollHeight
}

export function scrollKeyOwner(
  root: HTMLElement,
  target: EventTarget | null,
  key: NonNullable<ReturnType<typeof scrollKey>>,
) {
  const element = target instanceof Element ? target : undefined
  const owner = element?.closest<HTMLElement>("[data-scrollable]")

  if (!owner || owner === root) return root

  if (!root.contains(owner)) return owner

  return canScrollKey(owner, key) ? owner : root
}

export function isScrollKeyTarget(target: EventTarget | null, key: NonNullable<ReturnType<typeof scrollKey>>) {
  const element = target instanceof HTMLElement ? target : undefined

  if (!element) return true

  if (["INPUT", "TEXTAREA", "SELECT"].includes(element.tagName) || element.isContentEditable) return false

  if ((key === "page-up" || key === "page-down") && element.closest('button, a[href], [role="button"]')) return false

  return true
}

export function scrollTopFromThumbPointer(input: {
  pointer: number
  viewportTop: number
  grabOffset: number
  clientHeight: number
  scrollHeight: number
  thumbHeight: number
  /** Viewport height used for max scroll. Defaults to `clientHeight` (track == viewport). */
  scrollClientHeight?: number
}) {
  return scrollOffsetFromThumbPointer({
    pointer: input.pointer,
    viewportStart: input.viewportTop,
    grabOffset: input.grabOffset,
    clientSize: input.clientHeight,
    scrollSize: input.scrollHeight,
    thumbSize: input.thumbHeight,
    scrollClientSize: input.scrollClientHeight,
  })
}

export function scrollOffsetFromThumbPointer(input: {
  pointer: number
  viewportStart: number
  grabOffset: number
  clientSize: number
  scrollSize: number
  thumbSize: number
  scrollClientSize?: number
  reverse?: boolean
}) {
  return thumbScrollOffset(
    input.pointer - input.viewportStart - input.grabOffset,
    input.clientSize,
    input.scrollSize,
    input.thumbSize,
    input.scrollClientSize ?? input.clientSize,
    input.reverse ?? false,
  )
}

// Scalar arguments, so a drag's `pointermove` builds no options object.
function thumbScrollOffset(
  thumbOffset: number,
  clientSize: number,
  scrollSize: number,
  thumbSize: number,
  scrollClientSize: number,
  reverse: boolean,
) {
  const padding = 8
  const maxThumbStart = clientSize - padding * 2 - thumbSize

  if (maxThumbStart <= 0) return 0

  const thumbStart = Math.max(0, Math.min(thumbOffset - padding, maxThumbStart))
  const progress = reverse ? 1 - thumbStart / maxThumbStart : thumbStart / maxThumbStart

  return progress * Math.max(0, scrollSize - scrollClientSize)
}

/**
 * A scroll container that draws its own thumb, for a thumb in an external track or one corrected for virtualized
 * rows. Everything else scrolls with a plain `overflow: auto` element, which `styles/scrollbar.css` already styles.
 */
export function ScrollView(props: ScrollViewProps) {
  const i18n = useI18n()
  const merged = mergeProps({ orientation: "vertical", thumbVisibility: "hover" }, props)

  const [local, events, rest] = splitProps(
    merged,
    [
      "class",
      "children",
      "viewportRef",
      "orientation",
      "thumbVisibility",
      "thumbContainer",
      "thumbHoverTarget",
      "onBeforeScroll",
      "verticalScrollAdjustment",
      "style",
    ],
    [
      "onScroll",
      "onWheel",
      "onTouchStart",
      "onTouchMove",
      "onTouchEnd",
      "onTouchCancel",
      "onPointerDown",
      "onClick",
      "onKeyDown",
    ],
  )

  let rootRef!: HTMLDivElement
  let viewportRef!: HTMLDivElement
  let verticalThumbRef!: HTMLDivElement
  let horizontalThumbRef!: HTMLDivElement

  const thumbMount = () => local.thumbContainer

  const [state, setState] = createStore({
    verticalThumbSize: 0,
    verticalThumbStart: 0,
    horizontalThumbSize: 0,
    horizontalThumbStart: 0,
  })

  const [thumbState, setThumbState] = createSignal<ScrollThumbState>(INITIAL_SCROLL_THUMB_STATE)
  const vertical = () => local.orientation === "vertical" || local.orientation === "both"
  const horizontal = () => local.orientation === "horizontal" || local.orientation === "both"
  const thumbVisible = () => selectThumbVisible(thumbState(), local.thumbVisibility === "hover")
  let idleTimer: ReturnType<typeof setTimeout> | undefined

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
        if (prev.status !== "dragging") continue
        const thumb = prev.axis === "vertical" ? verticalThumbRef : horizontalThumbRef

        if (thumb?.hasPointerCapture(prev.pointerId)) thumb.releasePointerCapture(prev.pointerId)
        continue
      }

      clearTimeout(idleTimer)
      idleTimer = effect === "reset-idle-timer" ? setTimeout(onIdleElapsed, SCROLL_IDLE_MS) : undefined
    }
  }

  onCleanup(() => dispatch(SCROLL_THUMB_DISPOSED))

  const updateThumb = () => {
    if (!viewportRef) return
    const trackPadding = 8
    const minThumbSize = 32
    let verticalOverflow = false
    let horizontalOverflow = false

    if (vertical()) {
      const adjustment = local.verticalScrollAdjustment ?? 0
      const scrollHeight = viewportRef.scrollHeight + adjustment
      const trackSize = Math.max(0, (thumbMount()?.clientHeight || viewportRef.clientHeight) - trackPadding * 2)

      const size = trackSize
        ? Math.min(trackSize, Math.max((viewportRef.clientHeight / scrollHeight) * trackSize, minThumbSize))
        : 0

      const maxScroll = scrollHeight - viewportRef.clientHeight
      const maxStart = trackSize - size
      verticalOverflow = maxScroll > 0
      setState("verticalThumbSize", size)
      setState(
        "verticalThumbStart",
        trackPadding + (maxScroll > 0 ? ((viewportRef.scrollTop + adjustment) / maxScroll) * maxStart : 0),
      )
    }

    if (horizontal()) {
      const trackSize = Math.max(0, (thumbMount()?.clientWidth || viewportRef.clientWidth) - trackPadding * 2)

      const size = trackSize
        ? Math.min(trackSize, Math.max((viewportRef.clientWidth / viewportRef.scrollWidth) * trackSize, minThumbSize))
        : 0

      const maxScroll = viewportRef.scrollWidth - viewportRef.clientWidth
      const maxStart = trackSize - size
      const rtl = getComputedStyle(viewportRef).direction === "rtl"
      const offset = Math.max(0, Math.min(rtl ? -viewportRef.scrollLeft : viewportRef.scrollLeft, maxScroll))
      const start = maxScroll > 0 ? (offset / maxScroll) * maxStart : 0
      horizontalOverflow = maxScroll > 0
      setState("horizontalThumbSize", size)
      setState("horizontalThumbStart", trackPadding + (rtl ? maxStart - start : start))
    }

    dispatch(overflowChanged(verticalOverflow, horizontalOverflow))
  }

  onMount(() => {
    if (local.viewportRef) {
      local.viewportRef(viewportRef)
    }

    // The observer reports every target once when it starts observing (including a thumb mount that
    // appears later), after layout. Measuring here as well would force a synchronous layout per
    // ScrollView while the page is still rendering.
    createResizeObserver(
      () => [viewportRef, viewportRef.firstElementChild, thumbMount()].filter((element) => element != null),
      updateThumb,
    )
  })

  // Inputs that change the thumb without resizing anything: re-measure on change, but leave the
  // first measurement to the observer.
  createEffect(
    on([() => local.verticalScrollAdjustment, vertical, horizontal, thumbMount], () => updateThumb(), {
      defer: true,
    }),
  )

  createEffect(() => {
    if (!horizontal() || !viewportRef) return
    const observer = new MutationObserver(updateThumb)
    observer.observe(viewportRef, { childList: true, subtree: true, characterData: true })
    onCleanup(() => observer.disconnect())
  })

  const onHoverEnter = () => dispatch(HOVER_ENTERED)
  const onHoverLeave = () => dispatch(HOVER_LEFT)

  // One element owns hover at a time. Swapping it ends the hover, so a target that stops owning it while hovered
  // cannot leave the thumb shown.
  createEffect(() => {
    const target = local.thumbHoverTarget ?? (local.thumbContainer ? undefined : rootRef)

    if (!target) return

    target.addEventListener("pointerenter", onHoverEnter)
    target.addEventListener("pointerleave", onHoverLeave)
    onCleanup(() => {
      target.removeEventListener("pointerenter", onHoverEnter)
      target.removeEventListener("pointerleave", onHoverLeave)
      dispatch(HOVER_LEFT)
    })
  })

  const prepareScroll = () => {
    if (local.onBeforeScroll) {
      local.onBeforeScroll()
      updateThumb()
    }
  }

  const onThumbPointerDown = (axis: ScrollAxis, e: PointerEvent & { currentTarget: HTMLDivElement }) => {
    if (e.button !== 0) return
    e.preventDefault()
    e.stopPropagation()
    prepareScroll()
    const rect = e.currentTarget.getBoundingClientRect()

    dispatch({
      type: "drag.started",
      axis,
      pointerId: e.pointerId,
      grabOffset: axis === "vertical" ? e.clientY - rect.top : e.clientX - rect.left,
      rtl: axis === "horizontal" && getComputedStyle(viewportRef).direction === "rtl",
    })

    if (e.isTrusted && selectDraggingAxis(untrack(thumbState)) === axis) e.currentTarget.setPointerCapture(e.pointerId)
  }

  const onThumbPointerMove = (e: PointerEvent) => {
    const drag = untrack(thumbState)

    if (drag.status !== "dragging" || drag.pointerId !== e.pointerId) return
    prepareScroll()
    const vertical = drag.axis === "vertical"
    const track = thumbMount() ?? viewportRef
    const rect = track.getBoundingClientRect()

    const offset = thumbScrollOffset(
      vertical ? e.clientY - rect.top - drag.grabOffset : e.clientX - rect.left - drag.grabOffset,
      vertical ? track.clientHeight : track.clientWidth,
      vertical ? viewportRef.scrollHeight : viewportRef.scrollWidth,
      vertical ? state.verticalThumbSize : state.horizontalThumbSize,
      vertical ? viewportRef.clientHeight : viewportRef.clientWidth,
      drag.rtl,
    )

    if (vertical) {
      viewportRef.scrollTop = offset

      return
    }

    viewportRef.scrollLeft = drag.rtl ? -offset : offset
  }

  const onThumbPointerEnd = (e: PointerEvent) => dispatch({ type: "drag.ended", pointerId: e.pointerId })

  const renderVerticalThumb = () => (
    <div
      ref={(el) => {
        verticalThumbRef = el
      }}
      onPointerDown={(event) => onThumbPointerDown("vertical", event)}
      onPointerMove={onThumbPointerMove}
      onPointerUp={onThumbPointerEnd}
      onPointerCancel={onThumbPointerEnd}
      onLostPointerCapture={onThumbPointerEnd}
      class="scroll-view__thumb"
      data-orientation="vertical"
      data-visible={thumbVisible()}
      data-dragging={selectDraggingAxis(thumbState()) === "vertical"}
      style={{
        height: `${state.verticalThumbSize}px`,
        transform: `translateY(${state.verticalThumbStart}px)`,
        "z-index": 100, // ensure it displays over content
      }}
    />
  )

  const renderHorizontalThumb = () => (
    <div
      ref={(el) => {
        horizontalThumbRef = el
      }}
      onPointerDown={(event) => onThumbPointerDown("horizontal", event)}
      onPointerMove={onThumbPointerMove}
      onPointerUp={onThumbPointerEnd}
      onPointerCancel={onThumbPointerEnd}
      onLostPointerCapture={onThumbPointerEnd}
      class="scroll-view__thumb"
      data-orientation="horizontal"
      data-visible={thumbVisible()}
      data-dragging={selectDraggingAxis(thumbState()) === "horizontal"}
      style={{
        width: `${state.horizontalThumbSize}px`,
        transform: `translateX(${state.horizontalThumbStart}px)`,
        "z-index": 100,
      }}
    />
  )

  // Keybinds implementation
  // We ensure the viewport has a tabindex so it can receive focus
  // Keyboard scrolling jumps immediately, like the wheel, instead of animating.
  const onKeyDown = (e: KeyboardEvent) => {
    // If user is focused on an input inside the scroll view, don't hijack keys
    if (document.activeElement && ["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement.tagName)) {
      return
    }

    const next = scrollKey(e)

    // Modified navigation (for example Ctrl+Home) stays native, but must read
    // the same reconciled geometry as the keys handled by this component.
    const intent =
      next ??
      scrollKey({
        key: e.key,
        shiftKey: e.key === " " && e.shiftKey,
        altKey: false,
        ctrlKey: false,
        metaKey: false,
      })

    if (!intent) return

    if (!isScrollKeyTarget(e.target, intent)) return

    if (scrollKeyOwner(viewportRef, e.target, intent) !== viewportRef) return

    prepareScroll()

    if (!next) return
    const scrollAmount = viewportRef.clientHeight * 0.8
    const lineAmount = 40

    switch (next) {
      case "page-down":
        e.preventDefault()
        viewportRef.scrollBy({ top: scrollAmount })
        break
      case "page-up":
        e.preventDefault()
        viewportRef.scrollBy({ top: -scrollAmount })
        break
      case "home":
        e.preventDefault()
        viewportRef.scrollTo({ top: 0 })
        break
      case "end":
        e.preventDefault()
        viewportRef.scrollTo({ top: viewportRef.scrollHeight })
        break
      case "up":
        e.preventDefault()
        viewportRef.scrollBy({ top: -lineAmount })
        break
      case "down":
        e.preventDefault()
        viewportRef.scrollBy({ top: lineAmount })
        break
    }
  }

  return (
    <div
      ref={rootRef}
      class={`scroll-view ${local.class || ""}`}
      data-orientation={local.orientation}
      style={local.style}
      {...rest}
    >
      {/* Viewport */}
      <div
        ref={viewportRef}
        class="scroll-view__viewport"
        data-scrollable
        onScroll={(e) => {
          updateThumb()
          dispatch(SCROLLED)
          forward(events.onScroll, e)
        }}
        // Passive so the compositor never waits on the main thread to scroll; onWheel cannot cancel.
        on:wheel={{
          passive: true,
          handleEvent: (e) => {
            dispatch(SCROLLED)
            // SAFETY: this listener is on the viewport div, so `currentTarget` is that div and `target` an element in it.
            forward(events.onWheel, e as WheelEvent & { currentTarget: HTMLDivElement; target: Element })
          },
        }}
        onTouchStart={events.onTouchStart}
        onTouchMove={events.onTouchMove}
        onTouchEnd={events.onTouchEnd}
        onTouchCancel={events.onTouchCancel}
        onPointerDown={events.onPointerDown}
        onClick={events.onClick}
        tabIndex={0}
        role="region"
        aria-label={i18n.t("ui.scrollView.ariaLabel")}
        onKeyDown={(e) => {
          onKeyDown(e)
          forward(events.onKeyDown, e)
        }}
      >
        {local.children}
      </div>

      {/* Thumb Overlay — optionally portaled into an external track */}
      <Show when={selectShowVerticalThumb(thumbState())}>
        <Show when={thumbMount()} fallback={renderVerticalThumb()}>
          {(mount) => <Portal mount={mount()}>{renderVerticalThumb()}</Portal>}
        </Show>
      </Show>
      <Show when={selectShowHorizontalThumb(thumbState())}>
        <Show when={thumbMount()} fallback={renderHorizontalThumb()}>
          {(mount) => <Portal mount={mount()}>{renderHorizontalThumb()}</Portal>}
        </Show>
      </Show>
    </div>
  )
}

// A forwarded handler may be a function or Solid's bound `[handler, data]` pair.
function forward<E extends Event>(
  handler: JSX.EventHandlerUnion<HTMLDivElement, E> | undefined,
  event: E & { currentTarget: HTMLDivElement; target: Element },
) {
  if (handler instanceof Function) return handler(event)

  if (handler) handler[0](handler[1], event)
}
