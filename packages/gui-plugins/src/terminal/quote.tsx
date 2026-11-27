import { createMemo, createSignal, onCleanup, Show } from "solid-js"
import { Portal } from "solid-js/web"
import { makeEventListener } from "@solid-primitives/event-listener"
import { createResizeObserver } from "@solid-primitives/resize-observer"
import { Button } from "@opencode/ui/button"
import { Keybind } from "@opencode/ui/keybind"
import { Tooltip } from "@opencode/ui/tooltip"
import type { Terminal as Term } from "ghostty-web"
import { usePlugin, type ComposerQuoteAnchor } from "@opencode/plugin/gui"
import {
  createQuoteDispatch,
  createQuoteState,
  selectQuoteSourcePlace,
  selectQuoteToolbar,
  type QuoteEffect,
  type QuoteEvent,
  type QuoteSample,
} from "./quote-machine"

/** Where a terminal sends quoted output: the composer of the screen that shows it. */
export type TerminalQuoteTarget = {
  available: () => boolean
  add: (text: string, anchor?: ComposerQuoteAnchor) => void
}

/** The toolbar element, for hit-testing presses, and the driver's timer and frame. */
type QuoteHandles = {
  element?: HTMLElement
  settleTimer?: ReturnType<typeof setTimeout>
  placeFrame?: number
}

/** Offers to quote text selected in a terminal into the composer, like the timeline's Quote button. */
export function TerminalQuote(props: {
  term: Term
  container: HTMLElement
  target: TerminalQuoteTarget
  written: number
}) {
  const plugin = usePlugin()
  const mac = /(Mac|iPhone|iPad)/.test(navigator.platform)
  const [quoteState, setQuoteState] = createSignal(createQuoteState())
  const handles: QuoteHandles = {}
  const released: QuoteEvent = { type: "pointer.released" }
  const selected: QuoteEvent = { type: "selection.changed" }
  const scrolled: QuoteEvent = { type: "layout.changed", resized: false }
  const resized: QuoteEvent = { type: "layout.changed", resized: true }

  const geometry = () => ({
    offset: props.term.getScrollbackLength() - props.term.getViewportY(),
    written: props.written,
    bounds: props.container.getBoundingClientRect(),
    origin: props.term.renderer?.getCanvas().getBoundingClientRect(),
    metrics: props.term.renderer?.getMetrics(),
  })

  const sample = (): QuoteSample | undefined => {
    if (!props.term.hasSelection()) return

    return { ...geometry(), cells: props.term.getSelectionPosition() }
  }

  const run = (effect: QuoteEffect) => {
    if (effect.type === "schedule-settle") {
      clearTimeout(handles.settleTimer)
      handles.settleTimer = setTimeout(() => {
        handles.settleTimer = undefined
        const selection = sample()

        dispatch({
          type: "settle.sampled",
          attempt: effect.attempt,
          text: selection ? props.term.getSelection() : "",
          sample: selection,
        })
      }, effect.delayMs)

      return
    }

    if (effect.type === "cancel-settle") {
      clearTimeout(handles.settleTimer)
      handles.settleTimer = undefined

      return
    }

    if (effect.type === "schedule-place") {
      if (handles.placeFrame !== undefined) cancelAnimationFrame(handles.placeFrame)
      handles.placeFrame = requestAnimationFrame(() => {
        handles.placeFrame = undefined
        dispatch({ type: "place.sampled", attempt: effect.attempt, sample: sample() })
      })

      return
    }

    if (effect.type === "cancel-place") {
      if (handles.placeFrame !== undefined) cancelAnimationFrame(handles.placeFrame)
      handles.placeFrame = undefined

      return
    }

    if (effect.type === "clear-selection") return props.term.clearSelection()

    const source = effect.source

    if (!source) return props.target.add(effect.text, undefined)

    // The composer can retain this anchor after the toolbar closes or unmounts; it follows scrolling and resizing.
    const anchor: ComposerQuoteAnchor = (size) => {
      // Read first, so the anchor follows scrolling, resizing and disposal even while it returns nothing.
      const current = quoteState()

      if (!props.target.available() || !props.container.isConnected) return

      return selectQuoteSourcePlace(current, source, size, geometry)
    }

    props.target.add(effect.text, anchor)
  }

  const dispatch = createQuoteDispatch({ read: quoteState, write: setQuoteState, run })

  const toolbar = createMemo(() => selectQuoteToolbar(quoteState(), props.target.available()))

  // A cached tab can regain its DOM size after visibility changes without changing the terminal's grid.
  createResizeObserver(
    () => props.container,
    () => dispatch(scrolled),
  )

  const inside = (target: EventTarget | null) => target instanceof Node && !!handles.element?.contains(target)

  const subscriptions = [
    props.term.onSelectionChange(() => dispatch(selected)),
    props.term.onScroll(() => dispatch(scrolled)),
    // Both column reflow and row changes can move content without preserving its captured cell coordinates.
    props.term.onResize(() => dispatch(resized)),
  ]

  makeEventListener(document, "pointerdown", (event) => {
    if (inside(event.target)) return
    dispatch({ type: "pointer.down", button: event.button })
  })
  // A cancelled touch, a long-press or Ctrl+click menu, or leaving the window can end a press without `pointerup`.
  makeEventListener(document, "pointerup", () => dispatch(released))
  makeEventListener(document, "pointercancel", () => dispatch(released))
  makeEventListener(document, "contextmenu", () => dispatch(released))
  makeEventListener(window, "blur", () => dispatch(released))
  makeEventListener(props.container, "keydown", (event) =>
    dispatch({ type: "key.pressed", key: event.key, modified: event.metaKey || event.ctrlKey }),
  )
  makeEventListener(window, "resize", () => dispatch(scrolled))

  onCleanup(() => {
    subscriptions.forEach((subscription) => subscription.dispose())
    dispatch({ type: "disposed" })
  })

  return (
    <Show when={toolbar()}>
      {(view) => (
        <Portal>
          <div
            ref={(value) => {
              handles.element = value
              createResizeObserver(value, () =>
                dispatch({ type: "toolbar.measured", size: { width: value.offsetWidth, height: value.offsetHeight } }),
              )
              onCleanup(() => {
                handles.element = undefined
              })
            }}
            data-component="terminal-quote"
            data-prevent-autofocus
            role="toolbar"
            aria-label={plugin.t("quote.actions")}
            class="fixed z-50 flex items-center gap-0.5 rounded-[8px] p-0.5 shadow-[var(--v2-elevation-raised)]"
            style={{
              top: `${view().place.top}px`,
              left: `${view().place.left}px`,
              visibility: view().measured ? undefined : "hidden",
            }}
            onMouseDown={(event) => event.preventDefault()}
          >
            <Show when={view().truncated}>
              <span class="px-2 text-[12px] leading-[var(--line-height-compact)] text-v2-text-text-muted [font-weight:440]">
                {plugin.t("quote.tooLong")}
              </span>
            </Show>
            <Tooltip
              value={
                <>
                  {plugin.t("quote.addWithoutComment")}
                  <Keybind keys={[mac ? "⌥" : plugin.t("common.key.alt")]} variant="neutral" />
                </>
              }
              placement="top"
              openDelay={800}
            >
              <Button
                size="small"
                variant="ghost"
                icon="outline-quote"
                disabled={view().truncated}
                onClick={(event: MouseEvent) => dispatch({ type: "quote.added", skipComment: event.altKey })}
              >
                {plugin.t("quote.add")}
              </Button>
            </Tooltip>
          </div>
        </Portal>
      )}
    </Show>
  )
}
