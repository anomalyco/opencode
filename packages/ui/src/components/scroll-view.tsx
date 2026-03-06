import { createSignal, onCleanup, onMount, splitProps, type ComponentProps, Show, mergeProps } from "solid-js"
import { useI18n } from "../context/i18n"

export interface ScrollViewProps extends ComponentProps<"div"> {
  viewportRef?: (el: HTMLDivElement) => void
  orientation?: "vertical" | "horizontal" // currently only vertical is fully implemented for thumb
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

  const [isHovered, setIsHovered] = createSignal(false)
  const [isDragging, setIsDragging] = createSignal(false)

  const [thumbHeight, setThumbHeight] = createSignal(0)
  const [thumbTop, setThumbTop] = createSignal(0)
  const [showThumb, setShowThumb] = createSignal(false)

  const updateThumb = () => {
    if (!viewportRef) return
    const { scrollTop, scrollHeight, clientHeight } = viewportRef

    if (scrollHeight <= clientHeight || scrollHeight === 0) {
      setShowThumb(false)
      return
    }

    setShowThumb(true)
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

    setThumbHeight(height)
    setThumbTop(boundedTop)
  }

  onMount(() => {
    if (local.viewportRef) {
      local.viewportRef(viewportRef)
    }

    const observer = new ResizeObserver(() => {
      updateThumb()
    })

    observer.observe(viewportRef)
    // Also observe the first child if possible to catch content changes
    if (viewportRef.firstElementChild) {
      observer.observe(viewportRef.firstElementChild)
    }

    onCleanup(() => {
      observer.disconnect()
    })

    updateThumb()
  })

  let startY = 0
  let startScrollTop = 0

  const onThumbPointerDown = (e: PointerEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(true)
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
      setIsDragging(false)
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

    const scrollAmount = viewportRef.clientHeight * 0.8
    const lineAmount = 40

    switch (e.key) {
      case "PageDown":
        e.preventDefault()
        viewportRef.scrollBy({ top: scrollAmount, behavior: "smooth" })
        break
      case "PageUp":
        e.preventDefault()
        viewportRef.scrollBy({ top: -scrollAmount, behavior: "smooth" })
        break
      case "Home":
        e.preventDefault()
        viewportRef.scrollTo({ top: 0, behavior: "smooth" })
        break
      case "End":
        e.preventDefault()
        viewportRef.scrollTo({ top: viewportRef.scrollHeight, behavior: "smooth" })
        break
      case "ArrowUp":
        e.preventDefault()
        viewportRef.scrollBy({ top: -lineAmount, behavior: "smooth" })
        break
      case "ArrowDown":
        e.preventDefault()
        viewportRef.scrollBy({ top: lineAmount, behavior: "smooth" })
        break
    }
  }

  return (
    <div
      ref={rootRef}
      class={`scroll-view ${local.class || ""}`}
      style={local.style}
      onPointerEnter={() => setIsHovered(true)}
      onPointerLeave={() => setIsHovered(false)}
      {...rest}
    >
      {/* Viewport */}
      <div
        ref={viewportRef}
        class="scroll-view__viewport"
        onScroll={(e) => {
          updateThumb()
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

      {/* Thumb Overlay */}
      <Show when={showThumb()}>
        <div
          ref={thumbRef}
          onPointerDown={onThumbPointerDown}
          class="scroll-view__thumb"
          data-visible={isHovered() || isDragging()}
          data-dragging={isDragging()}
          style={{
            height: `${thumbHeight()}px`,
            transform: `translateY(${thumbTop()}px)`,
            "z-index": 100, // ensure it displays over content
          }}
        />
      </Show>
    </div>
  )
}
