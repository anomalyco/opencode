import { onCleanup, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { Portal } from "solid-js/web"
import { makeEventListener } from "@solid-primitives/event-listener"
import { createResizeObserver } from "@solid-primitives/resize-observer"
import { Button } from "@opencode/ui/button"
import { Keybind } from "@opencode/ui/keybind"
import { Tooltip } from "@opencode/ui/tooltip"
import type { Terminal as Term } from "ghostty-web"
import { usePlugin, type ComposerQuoteAnchor } from "@opencode/plugin/gui"

const SETTLE_MS = 150

const GAP = 8

// Matches the timeline's limit, so a quote never carries more than one from the conversation could.
const MAX_LENGTH = 20_000

/** Where a terminal sends quoted output: the composer of the screen that shows it. */
export type TerminalQuoteTarget = {
  available: () => boolean
  add: (text: string, anchor?: ComposerQuoteAnchor) => void
}

type Place = { top: number; left: number }

type Anchor = { top: number; bottom: number; start: number; end: number; single: boolean }

/** Offers to quote text selected in a terminal into the composer, like the timeline's Quote button. */
export function TerminalQuote(props: {
  term: Term
  container: HTMLElement
  target: TerminalQuoteTarget
  written: number
}) {
  const plugin = usePlugin()
  const mac = /(Mac|iPhone|iPad)/.test(navigator.platform)

  const [state, setState] = createStore<{
    text: string | undefined
    truncated: boolean
    anchor: Anchor | undefined
    bounds: DOMRect | undefined
    revision: number
    resized: number
    disposed: boolean
    size: { width: number; height: number }
  }>({
    text: undefined,
    truncated: false,
    anchor: undefined,
    bounds: undefined,
    revision: 0,
    resized: 0,
    disposed: false,
    size: { width: 0, height: 0 },
  })

  let element: HTMLElement | undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  let frame: number | undefined
  let pointer = false

  const close = () => {
    clearTimeout(timer)
    setState({ text: undefined, truncated: false, anchor: undefined, bounds: undefined })
  }

  // The selection is in cells, so its box comes from the canvas and the cell size.
  const place = () => {
    const canvas = props.term.renderer?.getCanvas()
    const metrics = props.term.renderer?.getMetrics()
    const position = props.term.getSelectionPosition()
    const bounds = props.container.getBoundingClientRect()

    // The selection scrolled out of view, or the terminal is hidden.
    if (!canvas || !metrics || !position || bounds.height === 0) return setState({ anchor: undefined, bounds })
    const origin = canvas.getBoundingClientRect()

    setState({
      bounds,
      anchor: {
        top: origin.top + position.start.y * metrics.height,
        bottom: origin.top + (position.end.y + 1) * metrics.height,
        start: origin.left + position.start.x * metrics.width,
        end: origin.left + (position.end.x + 1) * metrics.width,
        single: position.start.y === position.end.y,
      },
    })
  }

  const read = () => {
    if (pointer) return

    // Output keeps trailing blank rows a drag past the last line picks up.
    const text = props.term.hasSelection() ? props.term.getSelection().replace(/^\n+|\s+$/g, "") : ""

    if (!text) return close()
    setState({ text, truncated: text.length > MAX_LENGTH })
    place()
  }

  const schedule = () => {
    clearTimeout(timer)
    timer = setTimeout(read, SETTLE_MS)
  }

  const schedulePlace = () => {
    // The source editor can outlive the selection, and follows terminal scrolling and resizing.
    setState("revision", (value) => value + 1)

    if (frame !== undefined || state.text === undefined) return
    frame = requestAnimationFrame(() => {
      frame = undefined
      place()
    })
  }

  // A cached tab can regain its DOM size after visibility changes without changing the terminal's grid.
  createResizeObserver(() => props.container, schedulePlace)

  const inside = (target: EventTarget | null) => target instanceof Node && !!element?.contains(target)

  // ghostty-web announces a finished selection but clears one without an event, on a press or while typing.
  const subscriptions = [
    props.term.onSelectionChange(schedule),
    props.term.onScroll(schedulePlace),
    props.term.onResize(() => {
      // Both column reflow and row changes can move content without preserving its captured cell coordinates.
      setState("resized", (value) => value + 1)
      schedulePlace()
    }),
  ]

  makeEventListener(document, "pointerdown", (event) => {
    if (inside(event.target)) return
    pointer = true
    close()
  })
  makeEventListener(document, "pointerup", () => {
    if (!pointer) return
    pointer = false
    schedule()
  })
  makeEventListener(window, "blur", () => {
    pointer = false
  })
  makeEventListener(props.container, "keydown", (event) => {
    if (event.metaKey || event.ctrlKey || ["Shift", "Control", "Alt", "Meta"].includes(event.key)) return
    close()
  })
  makeEventListener(window, "resize", schedulePlace)

  onCleanup(() => {
    // The composer can retain a memoized anchor after this component is disposed.
    setState("disposed", true)
    subscriptions.forEach((subscription) => subscription.dispose())
    clearTimeout(timer)

    if (frame !== undefined) cancelAnimationFrame(frame)
  })

  const add = (skip: boolean) => {
    const text = state.text

    if (!text || state.truncated) return
    const cells = props.term.getSelectionPosition()
    const offset = props.term.getScrollbackLength() - props.term.getViewportY()
    const written = props.written
    const resized = state.resized

    const anchor: ComposerQuoteAnchor = (size) => {
      if (state.disposed) return
      void state.revision

      if (!props.target.available()) return

      // Ghostty has no stable line identity: a write can evict history even while its retained length grows.
      if (!cells || resized !== state.resized || written !== props.written || !props.container.isConnected) return
      const bounds = props.container.getBoundingClientRect()
      const canvas = props.term.renderer?.getCanvas()
      const metrics = props.term.renderer?.getMetrics()

      if (!bounds.width || !bounds.height || !canvas || !metrics) return
      const origin = canvas.getBoundingClientRect()
      const rows = offset - props.term.getScrollbackLength() + props.term.getViewportY()

      return position(size, bounds, {
        top: origin.top + (cells.start.y + rows) * metrics.height,
        bottom: origin.top + (cells.end.y + rows + 1) * metrics.height,
        start: origin.left + cells.start.x * metrics.width,
        end: origin.left + (cells.end.x + 1) * metrics.width,
        single: cells.start.y === cells.end.y,
      })
    }

    props.term.clearSelection()
    close()
    props.target.add(text, skip ? undefined : anchor)
  }

  // A one-line selection gets it above; a taller one below its end, where the drag usually stops.
  const position = (size = state.size, bounds = state.bounds, anchor = state.anchor): Place | undefined => {
    if (!bounds || !anchor) return

    const above = anchor.top - size.height - GAP
    const below = anchor.bottom + GAP
    const fitsAbove = above >= bounds.top + GAP && anchor.top <= bounds.bottom
    const fitsBelow = below + size.height <= bounds.bottom - GAP && anchor.bottom >= bounds.top
    const sides = anchor.single ? [fitsAbove && above, fitsBelow && below] : [fitsBelow && below, fitsAbove && above]
    const top = sides.find((side) => side !== false)
    const center = anchor.single ? (anchor.start + anchor.end - size.width) / 2 : anchor.end - size.width / 2

    return {
      top: top ?? bounds.bottom - size.height - GAP,
      left: Math.min(Math.max(center, bounds.left + GAP), bounds.right - size.width - GAP),
    }
  }

  return (
    <Show when={state.text !== undefined && props.target.available() && position()}>
      {(place) => (
        <Portal>
          <div
            ref={(value) => {
              element = value
              createResizeObserver(value, () =>
                setState("size", { width: value.offsetWidth, height: value.offsetHeight }),
              )
              onCleanup(() => {
                element = undefined
              })
            }}
            data-component="terminal-quote"
            data-prevent-autofocus
            role="toolbar"
            aria-label={plugin.t("quote.actions")}
            class="fixed z-50 flex items-center gap-0.5 rounded-[8px] p-0.5 shadow-[var(--v2-elevation-raised)]"
            style={{
              top: `${place().top}px`,
              left: `${place().left}px`,
              visibility: state.size.height === 0 ? "hidden" : undefined,
            }}
            onMouseDown={(event) => event.preventDefault()}
          >
            <Show when={state.truncated}>
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
                disabled={state.truncated}
                onClick={(event: MouseEvent) => add(event.altKey)}
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
