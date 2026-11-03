import { createEffect, createSignal, onCleanup, Show } from "solid-js"
import type { Platform } from "@/runtime/platform/platform"

// Narrower gaps leave nothing worth grabbing between the title and the actions.
const minWidth = 24

/** Whether this window hides its native titlebar and moves from app-drawn drag regions. */
export function windowDragEnabled(platform: Platform) {
  return platform.platform === "desktop" && (platform.os === "macos" || platform.os === "windows")
}

/** Fills the session header between the title and the actions; the active timeline hands it to the pane's drag area. */
export function SessionHeaderGap(props: { active: boolean; register?: (gap: HTMLElement) => () => void }) {
  let gap!: HTMLDivElement

  createEffect(() => {
    if (props.active && props.register) onCleanup(props.register(gap))
  })

  return <div ref={gap} data-slot="session-header-gap" aria-hidden="true" class="flex-1 self-stretch" />
}

/**
 * Moves the window from the session header's empty gap, as the hidden titlebar's row would. The area is pinned to the
 * pane over the gap rather than placed in the header: the header sticks inside the timeline's scroller, and Chromium
 * only recomputes drag regions on layout, so a region inside it would stay behind on scroll.
 */
export function SessionHeaderDrag(props: { pane?: HTMLElement; gap?: HTMLElement }) {
  const [rect, setRect] = createSignal<{ x: number; y: number; width: number; height: number }>()

  // Rename, truncation, readout updates and pane resizes all resize the gap; nothing here runs while the timeline scrolls.
  createEffect(() => {
    const pane = props.pane
    const gap = props.gap
    setRect(undefined)

    const row = gap?.closest<HTMLElement>(".session-header-layout")

    if (!pane || !gap || !row) return

    // The gap spans the row's width between the title and the actions; the area takes the row's full height.
    const measure = () => {
      const box = gap.getBoundingClientRect()
      const bounds = row.getBoundingClientRect()
      const origin = pane.getBoundingClientRect()
      setRect(
        box.width < minWidth
          ? undefined
          : { x: box.left - origin.left, y: bounds.top - origin.top, width: box.width, height: bounds.height },
      )
    }

    const resize = new ResizeObserver(measure)
    resize.observe(pane)
    resize.observe(gap)
    // The row's sections catch moves that keep the gap's size, such as the breadcrumb and the actions trading width.
    for (const section of row.children) resize.observe(section)
    onCleanup(() => resize.disconnect())
  })

  return (
    <Show when={rect()}>
      {(value) => (
        <div
          data-slot="session-header-drag"
          aria-hidden="true"
          class="absolute"
          style={{
            left: `${value().x}px`,
            top: `${value().y}px`,
            width: `${value().width}px`,
            height: `${value().height}px`,
          }}
          data-tauri-drag-region
        />
      )}
    </Show>
  )
}
