import { createEffect, createMemo, createSignal, on, onCleanup, Show, untrack } from "solid-js"
import { createStore } from "solid-js/store"
import { Portal } from "solid-js/web"
import { makeEventListener } from "@solid-primitives/event-listener"
import { createMediaQuery } from "@solid-primitives/media"
import { createResizeObserver } from "@solid-primitives/resize-observer"
import { Button } from "@opencode/ui/button"
import { Keybind } from "@opencode/ui/keybind"
import { Tooltip } from "@opencode/ui/tooltip"
import type { ComposerQuoteAnchor } from "@opencode/plugin/gui"
import { useLanguage } from "@/runtime/i18n/language"
import type { QuoteSource } from "@/composer/quote-source"
import { quotePosition } from "@/composer/quote-position"
import { captureQuoteSource } from "./quote-highlight"
import {
  activeQuote,
  canScheduleQuotePlace,
  canScheduleQuoteReflow,
  createQuoteState,
  DISPOSED_QUOTE_EVENT,
  isQuotePressing,
  QUOTE_SETTLE_MS,
  quoteToolbarView,
  RESET_QUOTE_EVENT,
  ROOT_RESIZED_QUOTE_EVENT,
  SELECTION_CHANGED_QUOTE_EVENT,
  SELECTION_CLEARED_QUOTE_EVENT,
  transitionQuote,
  VIEWPORT_MOVED_QUOTE_EVENT,
  type QuoteEffect,
  type QuoteEvent,
  type QuoteHorizontal,
  type QuotePlacement,
} from "./quote-machine"
import {
  characterRect,
  narrowSelection,
  quoteText,
  selectionRects,
  timelineSelection,
  type TimelineSelection,
} from "./quote-text"

const IS_MAC = /(Mac|iPod|iPhone|iPad)/.test(navigator.platform)

const SHORT_LINES = 3

/** Offers to quote text selected in the session timeline into the composer. */
export function createTimelineQuote(input: {
  root: () => HTMLElement | undefined
  sessionKey: () => string
  enabled: () => boolean
  add: (text: string, source: QuoteSource, anchor?: ComposerQuoteAnchor) => void
}) {
  let current = createQuoteState()
  const [quoteState, setQuoteState] = createSignal(current)
  // Counts timeline resizes, so a quote anchor in the composer follows a reflow after the toolbar closed.
  const [layout, setLayout] = createSignal(0)
  let element: HTMLElement | undefined
  let settleTimer: ReturnType<typeof setTimeout> | undefined
  let clearTimer: ReturnType<typeof setTimeout> | undefined
  let placeFrame: number | undefined
  let reflowFrame: number | undefined
  let unwatchPress: (() => void) | undefined

  const dispatch = (event: QuoteEvent) =>
    untrack(() => {
      const next = transitionQuote(current, event)

      if (next.state !== current) {
        current = next.state
        setQuoteState(current)
      }

      next.effects.forEach(run)
    })

  const run = (effect: QuoteEffect) => {
    if (effect.type === "press.watch") return watchPress()

    if (effect.type === "press.unwatch") {
      unwatchPress?.()
      unwatchPress = undefined

      return
    }

    if (effect.type === "settle.schedule" || effect.type === "settle.cancel") {
      clearTimeout(settleTimer)
      settleTimer = undefined

      if (effect.type === "settle.cancel") return
      settleTimer = setTimeout(() => {
        settleTimer = undefined
        dispatch({ type: "settle.ready", attempt: effect.attempt })
      }, QUOTE_SETTLE_MS)

      return
    }

    if (effect.type === "clear.schedule" || effect.type === "clear.cancel") {
      clearTimeout(clearTimer)
      clearTimer = undefined

      if (effect.type === "clear.cancel") return
      // Runs once the press is handled.
      clearTimer = setTimeout(() => {
        clearTimer = undefined
        dispatch({ type: "clear.ready", attempt: effect.attempt })
      })

      return
    }

    if (effect.type === "place.schedule" || effect.type === "place.cancel") {
      if (placeFrame !== undefined) cancelAnimationFrame(placeFrame)
      placeFrame = undefined

      if (effect.type === "place.cancel") return
      placeFrame = requestAnimationFrame(() => {
        placeFrame = undefined
        dispatch({ type: "place.ready", attempt: effect.attempt })
      })

      return
    }

    if (effect.type === "reflow.schedule" || effect.type === "reflow.cancel") {
      if (reflowFrame !== undefined) cancelAnimationFrame(reflowFrame)
      reflowFrame = undefined

      if (effect.type === "reflow.cancel") return
      reflowFrame = requestAnimationFrame(() => {
        reflowFrame = undefined
        dispatch({ type: "reflow.ready", attempt: effect.attempt })
      })

      return
    }

    if (effect.type === "quote.read") return read(effect.dismissed)

    if (effect.type === "place.measure") {
      const root = input.root()

      if (!root) return
      const selected = effect.quote.selected
      // The virtualizer removed the selected rows.
      const collapsed = selected.range.collapsed

      return dispatch({
        type: "place.measured",
        collapsed,
        placement: collapsed ? undefined : placeQuote(root, selected, effect.quote.horizontal),
      })
    }

    if (effect.type === "selection.clearIfSame") {
      const selection = window.getSelection()

      if (selection?.rangeCount && sameRange(selection.getRangeAt(0), effect.range)) selection.removeAllRanges()

      return
    }

    input.root()?.focus({ preventScroll: true })
  }

  const read = (dismissed: Range | undefined) => {
    const root = input.root()
    const selection = window.getSelection()

    if (dismissed && selection?.rangeCount && sameRange(selection.getRangeAt(0), dismissed))
      return dispatch({ type: "quote.measured", quote: undefined, dismissed: true })
    const next = root && input.enabled() && selection ? timelineSelection(selection, root) : undefined
    const quote = next ? quoteText(next) : undefined

    if (!root || !next || !quote?.text) return dispatch({ type: "quote.measured", quote: undefined })
    const horizontal = quote.horizontal && { ...quote.horizontal, origin: root.getBoundingClientRect().left }

    // Selecting a whole paragraph ends the selection at the start of the next block.
    const selected = quote.first
      ? narrowSelection(next, quote.first, quote.truncated ? next.end : (quote.last ?? next.end))
      : next

    dispatch({
      type: "quote.measured",
      quote: {
        text: quote.text,
        truncated: quote.truncated,
        selected,
        horizontal,
        placement: placeQuote(root, selected, horizontal),
      },
    })
  }

  // A press can end without a pointerup reaching the document (a native drag of the selection, a capture on a removed
  // node), so a move with the primary button up also releases it. The listeners exist only while a press is held.
  const watchPress = () => {
    unwatchPress?.()
    const release = () => dispatch({ type: "pointer.up", collapsed: window.getSelection()?.isCollapsed ?? true })
    const controller = new AbortController()
    const options = { signal: controller.signal }
    document.addEventListener("pointerup", release, options)
    document.addEventListener("pointercancel", release, options)
    document.addEventListener("contextmenu", release, options)
    document.addEventListener("dragend", release, options)
    window.addEventListener("blur", release, options)
    document.addEventListener("visibilitychange", () => document.hidden && release(), options)
    document.addEventListener("pointermove", (event) => (event.buttons & 1) === 0 && release(), {
      signal: controller.signal,
      passive: true,
    })
    unwatchPress = () => controller.abort()
  }

  const inside = (target: EventTarget | null) => target instanceof Node && !!element?.contains(target)

  // Select all from the keyboard or the app menu covers the whole window; in the timeline it selects the conversation.
  const containSelectAll = () => {
    const root = input.root()
    const selection = window.getSelection()
    const active = document.activeElement

    if (isQuotePressing(current) || !root || !input.enabled() || !selection || selection.rangeCount === 0) return

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
    dispatch(
      (window.getSelection()?.isCollapsed ?? true) ? SELECTION_CLEARED_QUOTE_EVENT : SELECTION_CHANGED_QUOTE_EVENT,
    )
  })
  makeEventListener(document, "pointerdown", (event) => {
    if (inside(event.target) || event.button !== 0) return
    const selection = window.getSelection()
    const target = event.target instanceof Element ? event.target : undefined

    const range =
      activeQuote(current) && !event.shiftKey && selection?.rangeCount && !target?.closest(".scroll-view__thumb")
        ? selection.getRangeAt(0).cloneRange()
        : undefined

    // A press on the selection itself may start dragging it; the page clears it on release otherwise. A press on
    // content the shell makes unselectable leaves the selection as it was, so it clears once the press is handled.
    const onSelection =
      !!range &&
      [...range.getClientRects()].some(
        (rect) =>
          event.clientX >= rect.left &&
          event.clientX <= rect.right &&
          event.clientY >= rect.top &&
          event.clientY <= rect.bottom,
      )

    dispatch({
      type: "pointer.down",
      collapsed: selection?.isCollapsed ?? true,
      clearRange: onSelection ? undefined : range,
    })
  })
  makeEventListener(document, "keydown", (event) => {
    if (event.defaultPrevented || event.isComposing) return
    const root = input.root()
    const active = document.activeElement

    if (event.key === "Escape" && activeQuote(current)) {
      const selection = window.getSelection()

      return dispatch({
        type: "escape",
        range: selection?.rangeCount ? selection.getRangeAt(0).cloneRange() : undefined,
        toolbarFocused: active instanceof Node && !!element?.contains(active),
      })
    }

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

  const moved = () => canScheduleQuotePlace(current) && dispatch(VIEWPORT_MOVED_QUOTE_EVENT)
  makeEventListener(document, "scroll", moved, { capture: true, passive: true })
  makeEventListener(window, "resize", moved)

  // A resized timeline, such as when a side panel opens, reflows the selected text.
  createResizeObserver(input.root, () => {
    setLayout((value) => value + 1)

    if (canScheduleQuoteReflow(current)) dispatch(ROOT_RESIZED_QUOTE_EVENT)
  })

  createEffect(on(input.sessionKey, () => dispatch(RESET_QUOTE_EVENT), { defer: true }))
  createEffect(() => {
    if (!input.enabled()) dispatch(RESET_QUOTE_EVENT)
  })
  onCleanup(() => dispatch(DISPOSED_QUOTE_EVENT))

  return {
    toolbar: createMemo(() => quoteToolbarView(quoteState())),
    // Alt skips the optional comment. Otherwise the editor replaces the selection toolbar.
    add: (skip: boolean) => {
      const quote = activeQuote(current)

      if (!quote?.text || quote.truncated) return
      const ranges = quoteText(quote.selected).ranges
      const source = captureQuoteSource(ranges)
      const selection = quote.selected
      const root = input.root()
      const sessionKey = input.sessionKey()
      let horizontalBounds = quote.horizontal
      let measuredLayout = layout()
      const initial = root ? measureQuote(root, selection, horizontalBounds) : undefined
      let last = initial

      const anchor: ComposerQuoteAnchor = (size) => {
        // Keep the source anchor reactive when a divider resizes the timeline after selection is cleared.
        const revision = layout()

        if (!root?.isConnected || input.sessionKey() !== sessionKey || !input.enabled()) return

        if (measuredLayout !== revision) {
          // Only quoted glyphs determine the width; the enclosing selection also includes block boxes and chrome.
          const rects = ranges
            .flatMap((range) => (range.startContainer.isConnected ? [...range.getClientRects()] : []))
            .filter((rect) => rect.width > 0 && rect.height > 0)

          horizontalBounds = rects.length
            ? {
                left: Math.min(...rects.map((rect) => rect.left)),
                right: Math.max(...rects.map((rect) => rect.right)),
                origin: root.getBoundingClientRect().left,
              }
            : undefined
          measuredLayout = revision
        }

        const measured = measureQuote(root, selection, horizontalBounds)
        last = measured ?? last

        if (!last) return
        const bounds = measured?.bounds ?? root.getBoundingClientRect()
        const extent = measured?.extent ?? { ...last.extent, left: bounds.left, right: bounds.right }
        const position = quotePosition(bounds, extent, size, window.matchMedia("(hover: none)").matches)

        // A virtualized source still belongs to the quote. Keep its draft open, pinned at the timeline edge.
        return measured ? position : { ...position, top: bounds.bottom - size.height - 8 }
      }

      window.getSelection()?.removeAllRanges()
      dispatch(RESET_QUOTE_EVENT)
      input.add(quote.text, source, skip ? undefined : anchor)
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
    const view = quote.toolbar()

    if (!view) return

    return quotePosition(view.bounds, view.extent, size, docked())
  }

  return (
    <Show when={position()}>
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
            <Show when={quote.toolbar()?.truncated}>
              <span class="px-2 text-[12px] leading-[var(--line-height-compact)] text-v2-text-text-muted [font-weight:440]">
                {language.t("session.quote.tooLong")}
              </span>
            </Show>
            <Tooltip
              value={
                <>
                  {language.t("session.quote.addWithoutComment")}
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
                disabled={quote.toolbar()?.truncated}
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

function placeQuote(
  root: HTMLElement,
  selected: TimelineSelection,
  horizontal: QuoteHorizontal | undefined,
): QuotePlacement | undefined {
  const measured = measureQuote(root, selected, horizontal)

  if (!measured) return undefined

  return {
    bounds: measured.bounds,
    // A selection scrolled out of view keeps its quote but hides the toolbar.
    extent:
      measured.extent.bottom > measured.bounds.top && measured.extent.top < measured.bounds.bottom
        ? measured.extent
        : undefined,
  }
}

function measureQuote(root: HTMLElement, selected: TimelineSelection, horizontal?: QuoteHorizontal) {
  if (selected.range.collapsed || !selected.start.node.isConnected || !selected.end.node.isConnected) return
  const view = root.getBoundingClientRect()

  if (!view.height || !view.width) return
  const sticky = root.querySelector<HTMLElement>("[data-session-title]")

  const bounds = {
    top: view.top + (sticky?.offsetHeight ?? 0),
    bottom: view.bottom,
    left: view.left,
    right: view.right,
  }

  const rects = selectionRects(selected)

  if (!rects.length) return
  const first = characterRect(selected.start, false)
  const last = characterRect(selected.end, true)
  const top = first?.top ?? Math.min(...rects.map((rect) => rect.top))
  const bottom = last?.bottom ?? Math.max(...rects.map((rect) => rect.bottom))

  const visible = rects.filter(
    (rect) => rect.bottom > Math.max(bounds.top, top) && rect.top < Math.min(bounds.bottom, bottom),
  )

  const line =
    first?.height ?? rects.map((rect) => rect.height).sort((a, b) => a - b)[Math.floor(rects.length / 2)] ?? 0

  const horizontalRects = visible.length ? visible : rects

  return {
    bounds,
    extent: {
      top,
      bottom,
      left: horizontal
        ? horizontal.left + view.left - horizontal.origin
        : Math.min(...horizontalRects.map((rect) => rect.left)),
      right: horizontal
        ? horizontal.right + view.left - horizontal.origin
        : Math.max(...horizontalRects.map((rect) => rect.right)),
      short: bottom - top < line * (SHORT_LINES + 0.5),
      backward: selected.backward,
    },
  }
}

function sameRange(a: Range, b: Range) {
  return a.compareBoundaryPoints(Range.START_TO_START, b) === 0 && a.compareBoundaryPoints(Range.END_TO_END, b) === 0
}

function editable(node: Node) {
  return node instanceof HTMLElement && (/^(INPUT|TEXTAREA|SELECT)$/.test(node.tagName) || node.isContentEditable)
}
