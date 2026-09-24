import { CliRenderEvents, type CliRenderer, type ScrollBoxRenderable } from "@opentui/core"
import { createEffect, createSignal, on, onCleanup, type Accessor } from "solid-js"

/** Lines kept from the previous page when a page fills, so the reader does not lose their place. */
export const PAGED_OUTPUT_OVERLAP_LINES = 5

/** Rows a page advances by; the remaining `overlap` rows repeat the bottom of the previous page. */
export function pageStep(pageHeight: number, overlap: number) {
  return Math.max(1, pageHeight - Math.max(0, Math.min(overlap, pageHeight - 1)))
}

/** Scroll offset whose page starts at the top of the viewport and holds the newest content. */
export function pageTarget(contentHeight: number, pageHeight: number, overlap = 0) {
  if (contentHeight <= pageHeight) return 0
  const step = pageStep(pageHeight, overlap)
  return step * Math.ceil((contentHeight - pageHeight) / step)
}

/**
 * Page top one step away from the current scroll offset in `direction`. Rounding to step multiples
 * snaps back onto the boundaries the transcript was generated on, so paging re-creates the layout
 * the reader saw while following.
 */
export function adjacentPageTop(currentTop: number, step: number, direction: -1 | 1) {
  const index = direction < 0 ? Math.ceil(currentTop / step) - 1 : Math.floor(currentTop / step) + 1
  return Math.max(0, index * step)
}

/**
 * Bottom padding that extends the content so the scroll box can reach the target page. The box
 * clamps its scroll position to `content - viewport`, so this is what gives the last page room to
 * show its content from the top, including the overlap rows.
 */
export function pagePad(contentHeight: number, pageHeight: number, overlap = 0) {
  const target = pageTarget(contentHeight, pageHeight, overlap)
  if (target === 0) return 0
  return Math.max(0, target + pageHeight - contentHeight)
}

/**
 * Paged follow for a transcript scroll box. Instead of native sticky-bottom (which reacts to the
 * unpadded height on the frame content grows and bounces by a line before padding catches up), the
 * viewport is pinned to page boundaries from the frame loop, so content fills the current page
 * without moving until the page is full. Each page repeats `overlap` rows from the previous page.
 */
export function createPagedScroll(input: {
  enabled: Accessor<boolean>
  scroll: Accessor<ScrollBoxRenderable | undefined>
  /** True while the transcript is being repositioned (navigation, history backfill, resize). */
  suspended: Accessor<boolean>
  /** Lines repeated from the bottom of the previous page when a page fills. */
  overlap: Accessor<number>
  renderer: CliRenderer
}) {
  const [following, setFollowing] = createSignal(false)
  let pad = 0
  let driving = false
  let attached: ScrollBoxRenderable | undefined

  // Page geometry shared by follow and by page-up/page-down navigation. `latest` is the current
  // final page top; intermediate page tops are `step` apart from it.
  const geometry = (scroll: ScrollBoxRenderable) => {
    const page = Math.max(1, scroll.viewport.height)
    const contentHeight = Math.max(0, scroll.scrollHeight - pad)
    const overlap = input.overlap()
    return {
      page,
      contentHeight,
      overlap,
      step: pageStep(page, overlap),
      latest: pageTarget(contentHeight, page, overlap),
    }
  }

  const measure = (scroll: ScrollBoxRenderable) => {
    const { page, contentHeight, overlap, latest } = geometry(scroll)
    return { target: latest, pad: pagePad(contentHeight, page, overlap) }
  }

  const applyPad = (value: number) => {
    if (value === pad) return
    pad = value
    const scroll = input.scroll()
    if (scroll && !scroll.isDestroyed) scroll.paddingBottom = value
  }

  // Any scroll position change we did not drive is the reader moving the viewport, so follow pauses
  // until they return to the current page. Content growth does not emit this event.
  const onScroll = () => {
    if (driving || !input.enabled()) return
    setFollowing(false)
  }

  const sync = () => {
    const scroll = input.scroll()
    if (!scroll || scroll.isDestroyed) return
    if (!input.enabled()) {
      applyPad(0)
      return
    }
    if (input.suspended()) {
      // Navigation and history backfill move the viewport on purpose; do not chase it afterwards.
      setFollowing(false)
      return
    }
    if (attached !== scroll) {
      attached?.verticalScrollBar.off("change", onScroll)
      attached = scroll
      scroll.verticalScrollBar.on("change", onScroll)
      // Adopt the reader's current position instead of assuming they are at the bottom, so
      // enabling paged output while scrolled up does not pull them down.
      const bottom = Math.max(0, scroll.scrollHeight - scroll.viewport.height)
      setFollowing(scroll.scrollTop >= bottom)
    }
    // Own the follow: native sticky would bounce a line on every content growth.
    if (scroll.stickyScroll) scroll.stickyScroll = false
    const { target, pad: nextPad } = measure(scroll)
    applyPad(nextPad)
    if (scroll.scrollTop >= target) {
      setFollowing(true)
    } else if (!following()) {
      return
    }
    // The pad takes effect on the next layout; driving before then would clamp to the old maximum.
    const maximum = Math.max(0, scroll.scrollHeight - scroll.viewport.height)
    if (scroll.scrollTop === target || target > maximum) return
    driving = true
    scroll.scrollTop = target
    driving = false
  }

  createEffect(
    on(input.enabled, (enabled) => {
      if (!enabled) {
        applyPad(0)
        return
      }
      const listener = () => sync()
      sync()
      input.renderer.on(CliRenderEvents.FRAME, listener)
      onCleanup(() => {
        input.renderer.off(CliRenderEvents.FRAME, listener)
        attached?.verticalScrollBar.off("change", onScroll)
        attached = undefined
        driving = false
        applyPad(0)
      })
    }),
  )

  return {
    padding: () => pad,
    following,
    setFollowing,
    geometry: () => {
      const scroll = input.scroll()
      return scroll && !scroll.isDestroyed ? geometry(scroll) : undefined
    },
  }
}
