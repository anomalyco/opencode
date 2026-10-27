import { createEffect, on, onCleanup, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { Portal } from "solid-js/web"
import { makeEventListener } from "@solid-primitives/event-listener"
import { createMediaQuery } from "@solid-primitives/media"
import { createResizeObserver } from "@solid-primitives/resize-observer"
import { Button } from "@opencode/ui/button"
import { Keybind } from "@opencode/ui/keybind"
import { Tooltip } from "@opencode/ui/tooltip"
import { useLanguage } from "@/runtime/i18n/language"
import type { QuoteSource } from "@/composer/quote-source"
import { captureQuoteSource } from "./quote-highlight"
import {
  characterRect,
  narrowSelection,
  quoteText,
  selectionRects,
  timelineSelection,
  type TimelineSelection,
} from "./quote-text"

const IS_MAC = /(Mac|iPod|iPhone|iPad)/.test(navigator.platform)

const SETTLE_MS = 150

const SHORT_LINES = 3

const GAP = 8

type Rect = { top: number; bottom: number; left: number; right: number }

type Extent = Rect & { short: boolean; backward: boolean }

/** Offers to quote text selected in the session timeline into the composer. */
export function createTimelineQuote(input: {
  root: () => HTMLElement | undefined
  sessionKey: () => string
  enabled: () => boolean
  add: (text: string, comment: boolean, source: QuoteSource) => void
}) {
  const [state, setState] = createStore<{
    text: string | undefined
    truncated: boolean
    extent: Extent | undefined
    bounds: Rect | undefined
  }>({ text: undefined, truncated: false, extent: undefined, bounds: undefined })

  let selected: TimelineSelection | undefined
  let horizontal: { left: number; right: number; origin: number } | undefined
  let element: HTMLElement | undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  let frame: number | undefined
  let pointer = false
  let reflow: number | undefined
  // The selection Escape dismissed, which stays dismissed until it changes or clears.
  let dismissed: Range | undefined

  const close = () => {
    selected = undefined
    horizontal = undefined
    dismissed = undefined
    clearTimeout(timer)

    if (reflow !== undefined) cancelAnimationFrame(reflow)
    reflow = undefined
    setState({ text: undefined, truncated: false, extent: undefined, bounds: undefined })
  }

  const dismiss = () => {
    const focused = document.activeElement instanceof Node && !!element?.contains(document.activeElement)
    const selection = window.getSelection()
    close()
    dismissed = selection?.rangeCount ? selection.getRangeAt(0).cloneRange() : undefined

    if (focused) input.root()?.focus({ preventScroll: true })
  }

  const place = () => {
    const root = input.root()

    if (!root || !selected) return
    const view = root.getBoundingClientRect()
    const sticky = root.querySelector("[data-session-title]")

    const bounds = {
      top: view.top + (sticky instanceof HTMLElement ? sticky.offsetHeight : 0),
      bottom: view.bottom,
      left: view.left,
      right: view.right,
    }

    // The virtualizer removed the selected rows.
    if (selected.range.collapsed) return close()

    const rects = selectionRects(selected)
    const first = characterRect(selected.start, false)
    const last = characterRect(selected.end, true)
    const top = first?.top ?? Math.min(...rects.map((rect) => rect.top))
    const bottom = last?.bottom ?? Math.max(...rects.map((rect) => rect.bottom))

    const visible = rects.filter(
      (rect) => rect.bottom > Math.max(bounds.top, top) && rect.top < Math.min(bounds.bottom, bottom),
    )

    const line =
      first?.height ?? rects.map((rect) => rect.height).sort((a, b) => a - b)[Math.floor(rects.length / 2)] ?? 0

    setState({
      bounds,
      extent: visible.length
        ? {
            top,
            bottom,
            left: horizontal
              ? horizontal.left + view.left - horizontal.origin
              : Math.min(...visible.map((rect) => rect.left)),
            right: horizontal
              ? horizontal.right + view.left - horizontal.origin
              : Math.max(...visible.map((rect) => rect.right)),
            short: bottom - top < line * (SHORT_LINES + 0.5),
            backward: selected.backward,
          }
        : undefined,
    })
  }

  const read = () => {
    if (pointer) return
    const root = input.root()
    const selection = window.getSelection()

    if (dismissed && selection?.rangeCount && sameRange(selection.getRangeAt(0), dismissed)) return
    dismissed = undefined
    const next = root && input.enabled() && selection ? timelineSelection(selection, root) : undefined
    const quote = next ? quoteText(next) : undefined

    if (!root || !next || !quote?.text) return close()
    horizontal = quote.horizontal && { ...quote.horizontal, origin: root.getBoundingClientRect().left }
    // Selecting a whole paragraph ends the selection at the start of the next block.
    selected = quote.first
      ? narrowSelection(next, quote.first, quote.truncated ? next.end : (quote.last ?? next.end))
      : next
    setState({ text: quote.text, truncated: quote.truncated })
    place()
  }

  const schedule = () => {
    clearTimeout(timer)
    timer = setTimeout(read, SETTLE_MS)
  }

  const schedulePlace = () => {
    if (frame !== undefined || !selected) return
    frame = requestAnimationFrame(() => {
      frame = undefined
      place()
    })
  }

  const release = () => {
    if (!pointer) return
    pointer = false
    schedule()
  }

  const inside = (target: EventTarget | null) => target instanceof Node && !!element?.contains(target)

  // Select all from the keyboard or the app menu covers the whole window; in the timeline it selects the conversation.
  const containSelectAll = () => {
    const root = input.root()
    const selection = window.getSelection()
    const active = document.activeElement

    if (pointer || !root || !input.enabled() || !selection || selection.rangeCount === 0) return

    if (active !== document.body && !(active instanceof Node && root.contains(active) && !editable(active))) return
    const range = selection.getRangeAt(0)
    const content = document.createRange()
    content.selectNodeContents(root)

    if (
      range.compareBoundaryPoints(Range.START_TO_START, content) < 0 &&
      range.compareBoundaryPoints(Range.END_TO_END, content) > 0
    )
      selection.selectAllChildren(root)
  }

  makeEventListener(document, "selectionchange", () => {
    containSelectAll()

    // Only a new selection waits to settle; a cleared one closes at once.
    if (window.getSelection()?.isCollapsed ?? true) return close()
    schedule()
  })
  makeEventListener(document, "pointerdown", (event) => {
    if (inside(event.target) || event.button !== 0) return
    pointer = true
    const selection = window.getSelection()
    const target = event.target instanceof Element ? event.target : undefined

    if (state.text === undefined || event.shiftKey || !selection?.rangeCount || target?.closest(".scroll-view__thumb"))
      return
    const range = selection.getRangeAt(0).cloneRange()

    // A press on the selection itself may start dragging it; the page clears it on release otherwise.
    if (
      [...range.getClientRects()].some(
        (rect) =>
          event.clientX >= rect.left &&
          event.clientX <= rect.right &&
          event.clientY >= rect.top &&
          event.clientY <= rect.bottom,
      )
    )
      return

    // A press on content the shell makes unselectable leaves the selection as it was, so clear it once the press is
    // handled.
    setTimeout(() => {
      if (selection.rangeCount && sameRange(selection.getRangeAt(0), range)) selection.removeAllRanges()
    })
  })
  makeEventListener(document, "pointerup", release)
  makeEventListener(document, "pointercancel", release)
  makeEventListener(document, "contextmenu", release)
  makeEventListener(window, "blur", release)
  makeEventListener(document, "keydown", (event) => {
    if (event.defaultPrevented || event.isComposing) return
    const root = input.root()
    const active = document.activeElement

    if (event.key === "Escape" && state.text !== undefined) return dismiss()
    const action = element?.querySelector<HTMLButtonElement>("button:not(:disabled)")

    if (
      event.key === "Tab" &&
      !event.shiftKey &&
      !event.metaKey &&
      !event.ctrlKey &&
      !event.altKey &&
      action &&
      (active === root || active === document.body)
    ) {
      event.preventDefault()
      action.focus()

      return
    }

    // The shell disables selection, so the browser's select all finds nothing.
    if (
      root &&
      input.enabled() &&
      (event.metaKey || event.ctrlKey) &&
      !event.altKey &&
      !event.shiftKey &&
      event.key.toLowerCase() === "a" &&
      active instanceof Node &&
      root.contains(active) &&
      !editable(active)
    ) {
      event.preventDefault()
      window.getSelection()?.selectAllChildren(root)
    }
  })
  makeEventListener(document, "scroll", schedulePlace, { capture: true, passive: true })
  makeEventListener(window, "resize", schedulePlace)

  // A resized timeline, such as when a side panel opens, reflows the selected text.
  createResizeObserver(input.root, () => {
    if (!selected || reflow !== undefined) return
    reflow = requestAnimationFrame(() => {
      reflow = undefined
      read()
    })
  })

  createEffect(on(input.sessionKey, close, { defer: true }))
  createEffect(() => {
    if (!input.enabled()) close()
  })
  onCleanup(() => {
    clearTimeout(timer)

    if (frame !== undefined) cancelAnimationFrame(frame)

    if (reflow !== undefined) cancelAnimationFrame(reflow)
  })

  return {
    state,
    // With Alt held, the quote opens its comment editor in the composer.
    add: (comment: boolean) => {
      const text = state.text

      if (!text || state.truncated) return
      const source = selected ? captureQuoteSource(quoteText(selected).ranges) : []
      window.getSelection()?.removeAllRanges()
      close()
      input.add(text, comment, source)
    },
    setElement: (value: HTMLElement | undefined) => {
      element = value
    },
  }
}

export type TimelineQuoteController = ReturnType<typeof createTimelineQuote>

export function TimelineQuote(props: { controller: TimelineQuoteController }) {
  const language = useLanguage()
  const quote = props.controller
  // Touch screens show their own menu over the selection.
  const docked = createMediaQuery("(hover: none)")
  const [size, setSize] = createStore({ width: 0, height: 0 })

  const position = () => {
    const bounds = quote.state.bounds
    const extent = quote.state.extent

    if (!bounds || !extent) return

    const pinned = bounds.bottom - size.height - GAP

    if (docked()) return { top: pinned, left: (bounds.left + bounds.right - size.width) / 2 }

    const above = extent.top - size.height - GAP
    const below = extent.bottom + GAP
    const fitsAbove = above >= bounds.top + GAP && extent.top <= bounds.bottom
    const fitsBelow = below + size.height <= bounds.bottom - GAP && extent.bottom >= bounds.top

    // Short selections get it above; taller ones at the end they were dragged towards.
    const sides =
      extent.short || extent.backward
        ? [fitsAbove && above, fitsBelow && below]
        : [fitsBelow && below, fitsAbove && above]

    const top = sides.find((side) => side !== false) ?? pinned
    const center = (extent.left + extent.right - size.width) / 2

    return {
      top,
      left: Math.min(Math.max(center, bounds.left + GAP), bounds.right - size.width - GAP),
    }
  }

  return (
    <Show when={quote.state.text !== undefined && position()}>
      {(place) => (
        <Portal>
          <div
            ref={(element) => {
              quote.setElement(element)
              createResizeObserver(element, () => setSize({ width: element.offsetWidth, height: element.offsetHeight }))
              onCleanup(() => quote.setElement(undefined))
            }}
            data-component="timeline-quote"
            data-prevent-autofocus
            role="toolbar"
            aria-label={language.t("session.quote.actions")}
            class="fixed z-50 flex items-center gap-0.5 rounded-[8px] p-0.5 shadow-[var(--v2-elevation-raised)]"
            style={{
              top: `${place().top}px`,
              left: `${place().left}px`,
              visibility: size.height === 0 ? "hidden" : undefined,
            }}
            onMouseDown={(event) => event.preventDefault()}
          >
            <Show when={quote.state.truncated}>
              <span class="px-2 text-[12px] leading-[var(--line-height-compact)] text-v2-text-text-muted [font-weight:440]">
                {language.t("session.quote.tooLong")}
              </span>
            </Show>
            <Tooltip
              value={
                <>
                  {language.t("session.quote.addWithComment")}
                  <Keybind keys={[IS_MAC ? "⌥" : language.t("common.key.alt")]} variant="neutral" />
                </>
              }
              placement="top"
              openDelay={800}
            >
              <Button
                size="small"
                variant="ghost"
                icon="outline-quote"
                disabled={quote.state.truncated}
                onClick={(event: MouseEvent) => quote.add(event.altKey)}
              >
                {language.t("session.quote.add")}
              </Button>
            </Tooltip>
          </div>
        </Portal>
      )}
    </Show>
  )
}

function sameRange(a: Range, b: Range) {
  return a.compareBoundaryPoints(Range.START_TO_START, b) === 0 && a.compareBoundaryPoints(Range.END_TO_END, b) === 0
}

function editable(node: Node) {
  return node instanceof HTMLElement && (/^(INPUT|TEXTAREA|SELECT)$/.test(node.tagName) || node.isContentEditable)
}
