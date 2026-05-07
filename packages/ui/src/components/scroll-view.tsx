import { onMount, splitProps, type ComponentProps, Show, mergeProps } from "solid-js"
import { createResizeObserver } from "@solid-primitives/resize-observer"
import { createStore } from "solid-js/store"
import { useI18n } from "../context/i18n"

/**
 * ScrollView component with custom scrollbar thumb and keyboard navigation.
 * 
 * Features:
 * - Custom scrollbar thumb (4px wide, only visible on hover/drag)
 * - Hides native scrollbar completely
 * - Keyboard navigation (PageUp/Down, Home/End, Arrow keys)
 * - ResizeObserver for automatic thumb size/position updates
 * - Drag-to-scroll support
 * 
 * Use cases:
 * - When you need a custom-styled scrollbar (e.g., session-review diff panel)
 * - When native scrollbar doesn't fit the design
 * 
 * NOT for:
 * - Simple lists (use List component with native scrollbar instead)
 * - When native scrollbar is acceptable (lighter weight)
 * 
 * Architecture:
 * - Uses data-component/data-slot naming (not BEM classes)
 * - Independent from List component (different scroll strategies)
 */

export interface ScrollViewProps extends ComponentProps<"div"> {
  viewportRef?: (el: HTMLDivElement) => void
  orientation?: "vertical" | "horizontal"
}

export const scrollKey = (event: Pick<KeyboardEvent, "key" | "altKey" | "ctrlKey" | "metaKey" | "shiftKey">) => {
  if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return

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
  }
}

export function ScrollView(props: ScrollViewProps) {
  const i18n = useI18n()
  const merged = mergeProps({ orientation: "vertical" }, props)
  const [local, events, rest] = splitProps(
    merged,
    ["class", "children", "viewportRef", "orientation", "style"],
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
  let thumbRef!: HTMLDivElement

  const [state, setState] = createStore({
    isHovered: false,
    isDragging: false,
    thumbHeight: 0,
    thumbTop: 0,
    showThumb: false,
  })
  const isHovered = () => state.isHovered
  const isDragging = () => state.isDragging
  const thumbHeight = () => state.thumbHeight
  const thumbTop = () => state.thumbTop
  const showThumb = () => state.showThumb

  let rafId: number | null = null

  const updateThumb = () => {
    if (!viewportRef) return
    const { scrollTop, scrollHeight, clientHeight } = viewportRef

    if (scrollHeight <= clientHeight || scrollHeight === 0) {
      if (state.showThumb) {
        setState("showThumb", false)
      }
      return
    }

    const trackPadding = 8
    const trackHeight = clientHeight - trackPadding * 2

    const minThumbHeight = 32
    // Calculate raw thumb height based on ratio
    let height = (clientHeight / scrollHeight) * trackHeight
    height = Math.max(height, minThumbHeight)

    const maxScrollTop = scrollHeight - clientHeight
    const maxThumbTop = trackHeight - height

    const top = maxScrollTop > 0 ? (scrollTop / maxScrollTop) * maxThumbTop : 0

    // Ensure thumb stays within bounds (shouldn't be necessary due to math above, but good for safety)
    const boundedTop = trackPadding + Math.max(0, Math.min(top, maxThumbTop))

    // Only update if values actually changed (with small threshold to avoid floating point issues)
    const heightChanged = Math.abs(state.thumbHeight - height) > 0.5
    const topChanged = Math.abs(state.thumbTop - boundedTop) > 0.5
    const showChanged = !state.showThumb

    if (heightChanged || topChanged || showChanged) {
      setState({
        showThumb: true,
        thumbHeight: height,
        thumbTop: boundedTop,
      })
    }
  }

  const scheduleUpdateThumb = () => {
    if (rafId !== null) {
      cancelAnimationFrame(rafId)
    }
    rafId = requestAnimationFrame(() => {
      rafId = null
      updateThumb()
    })
  }

  onMount(() => {
    if (local.viewportRef) {
      local.viewportRef(viewportRef)
    }

    const observer = new ResizeObserver(() => {
      scheduleUpdateThumb()
    })

    observer.observe(viewportRef)
    // Also observe the first child if possible to catch content changes
    if (viewportRef.firstElementChild) {
      observer.observe(viewportRef.firstElementChild)
    }

    onCleanup(() => {
      observer.disconnect()
      if (rafId !== null) {
        cancelAnimationFrame(rafId)
        rafId = null
      }
    })

    scheduleUpdateThumb()
  })

  let startY = 0
  let startScrollTop = 0

  const onThumbPointerDown = (e: PointerEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setState("isDragging", true)
    startY = e.clientY
    startScrollTop = viewportRef.scrollTop

    thumbRef.setPointerCapture(e.pointerId)

    const onPointerMove = (e: PointerEvent) => {
      const deltaY = e.clientY - startY
      const { scrollHeight, clientHeight } = viewportRef
      const maxScrollTop = scrollHeight - clientHeight
      const maxThumbTop = clientHeight - thumbHeight()

      if (maxThumbTop > 0) {
        const scrollDelta = deltaY * (maxScrollTop / maxThumbTop)
        viewportRef.scrollTop = startScrollTop + scrollDelta
      }
    }

    const onPointerUp = (e: PointerEvent) => {
      setState("isDragging", false)
      thumbRef.releasePointerCapture(e.pointerId)
      thumbRef.removeEventListener("pointermove", onPointerMove)
      thumbRef.removeEventListener("pointerup", onPointerUp)
    }

    thumbRef.addEventListener("pointermove", onPointerMove)
    thumbRef.addEventListener("pointerup", onPointerUp)
  }

  // Keybinds implementation
  // We ensure the viewport has a tabindex so it can receive focus
  // We can also explicitly catch PageUp/Down if we want smooth scroll or specific behavior,
  // but native usually handles this perfectly. Let's explicitly ensure it behaves well.
  const onKeyDown = (e: KeyboardEvent) => {
    // If user is focused on an input inside the scroll view, don't hijack keys
    if (document.activeElement && ["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement.tagName)) {
      return
    }

    const next = scrollKey(e)
    if (!next) return

    const scrollAmount = viewportRef.clientHeight * 0.8
    const lineAmount = 40

    switch (next) {
      case "page-down":
        e.preventDefault()
        viewportRef.scrollBy({ top: scrollAmount, behavior: "smooth" })
        break
      case "page-up":
        e.preventDefault()
        viewportRef.scrollBy({ top: -scrollAmount, behavior: "smooth" })
        break
      case "home":
        e.preventDefault()
        viewportRef.scrollTo({ top: 0, behavior: "smooth" })
        break
      case "end":
        e.preventDefault()
        viewportRef.scrollTo({ top: viewportRef.scrollHeight, behavior: "smooth" })
        break
      case "up":
        e.preventDefault()
        viewportRef.scrollBy({ top: -lineAmount, behavior: "smooth" })
        break
      case "down":
        e.preventDefault()
        viewportRef.scrollBy({ top: lineAmount, behavior: "smooth" })
        break
    }
  }

  return (
    <div
      ref={rootRef}
      data-component="scroll-view"
      class={local.class}
      style={local.style}
      onPointerEnter={() => setState("isHovered", true)}
      onPointerLeave={() => setState("isHovered", false)}
      {...rest}
    >
      <div
        ref={viewportRef}
        data-slot="scroll-view-viewport"
        onScroll={(e) => {
          scheduleUpdateThumb()
          if (typeof events.onScroll === "function") events.onScroll(e as any)
        }}
        onWheel={events.onWheel as any}
        onTouchStart={events.onTouchStart as any}
        onTouchMove={events.onTouchMove as any}
        onTouchEnd={events.onTouchEnd as any}
        onTouchCancel={events.onTouchCancel as any}
        onPointerDown={events.onPointerDown as any}
        onClick={events.onClick as any}
        tabIndex={0}
        role="region"
        aria-label={i18n.t("ui.scrollView.ariaLabel")}
        onKeyDown={(e) => {
          onKeyDown(e)
          if (typeof events.onKeyDown === "function") events.onKeyDown(e as any)
        }}
      >
        {local.children}
      </div>

      <Show when={showThumb()}>
        <div
          ref={thumbRef}
          onPointerDown={onThumbPointerDown}
          data-slot="scroll-view-thumb"
          data-visible={isHovered() || isDragging()}
          data-dragging={isDragging()}
          style={{
            height: `${thumbHeight()}px`,
            transform: `translateY(${thumbTop()}px)`,
            "z-index": 100,
          }}
        />
      </Show>
    </div>
  )
}
