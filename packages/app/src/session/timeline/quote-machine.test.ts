import { describe, expect, test } from "bun:test"
import {
  activeQuote,
  createQuoteState,
  DISPOSED_QUOTE_EVENT,
  isQuotePressing,
  quoteToolbarView,
  RESET_QUOTE_EVENT,
  ROOT_RESIZED_QUOTE_EVENT,
  SELECTION_CHANGED_QUOTE_EVENT,
  SELECTION_CLEARED_QUOTE_EVENT,
  transitionQuote,
  VIEWPORT_MOVED_QUOTE_EVENT,
  type ActiveQuote,
  type QuoteEffect,
  type QuoteEvent,
  type QuoteState,
} from "./quote-machine"
import type { TimelineSelection } from "./quote-text"

const node = document.createTextNode("selected text")

const selected: TimelineSelection = {
  range: document.createRange(),
  start: { node, offset: 0 },
  end: { node, offset: 13 },
  backward: false,
}

const bounds = { top: 0, bottom: 600, left: 0, right: 800 }

const extent = { top: 100, bottom: 120, left: 10, right: 200, short: true, backward: false }

const quote = (text = "selected text", inView = true): ActiveQuote => ({
  text,
  truncated: false,
  selected,
  horizontal: undefined,
  placement: { bounds, extent: inView ? extent : undefined },
})

const escape: QuoteEvent = { type: "escape", range: selected.range, toolbarFocused: false }

function play(events: QuoteEvent[], state: QuoteState = createQuoteState()) {
  const effects: QuoteEffect[] = []

  const final = events.reduce((current, event) => {
    const next = transitionQuote(current, event)
    effects.push(...next.effects)

    return next.state
  }, state)

  return { state: final, effects }
}

const settleOf = (state: QuoteState) => state.settle ?? -1

// A keyboard selection settles and reads as `text`.
function select(state: QuoteState, text = "selected text") {
  const changed = transitionQuote(state, SELECTION_CHANGED_QUOTE_EVENT).state

  return play(
    [
      { type: "settle.ready", attempt: settleOf(changed) },
      { type: "quote.measured", quote: quote(text) },
    ],
    changed,
  ).state
}

function shown() {
  return select(createQuoteState())
}

describe("quote machine", () => {
  test("a press that never sees its release no longer blocks the toolbar after a session switch", () => {
    const pressed = transitionQuote(createQuoteState(), { type: "pointer.down", collapsed: true })
    expect(pressed.effects).toEqual([{ type: "press.watch" }])
    expect(isQuotePressing(pressed.state)).toBe(true)

    // The session changes mid-press and the pointerup never reaches the document.
    const reset = transitionQuote(pressed.state, RESET_QUOTE_EVENT)
    expect(reset.effects).toEqual([{ type: "press.unwatch" }])
    expect(isQuotePressing(reset.state)).toBe(false)

    // Shift+Arrow then selects text from the keyboard.
    const changed = transitionQuote(reset.state, SELECTION_CHANGED_QUOTE_EVENT)
    expect(changed.effects).toEqual([{ type: "settle.schedule", attempt: settleOf(changed.state) }])
    const read = transitionQuote(changed.state, { type: "settle.ready", attempt: settleOf(changed.state) })
    expect(read.effects).toEqual([{ type: "quote.read" }])
    expect(quoteToolbarView(transitionQuote(read.state, { type: "quote.measured", quote: quote() }).state)).toEqual({
      text: "selected text",
      truncated: false,
      bounds,
      extent,
    })
  })

  test("a release seen as a primary-button-up move reads the drag selection", () => {
    const result = play([
      { type: "pointer.down", collapsed: true },
      SELECTION_CHANGED_QUOTE_EVENT,
      SELECTION_CHANGED_QUOTE_EVENT,
    ])

    // The selection waits for the release.
    expect(result.effects).toEqual([{ type: "press.watch" }])

    const released = transitionQuote(result.state, { type: "pointer.up", collapsed: false })
    expect(released.effects).toEqual([
      { type: "press.unwatch" },
      { type: "settle.schedule", attempt: settleOf(released.state) },
    ])

    const read = play(
      [
        { type: "settle.ready", attempt: settleOf(released.state) },
        { type: "quote.measured", quote: quote() },
      ],
      released.state,
    )

    expect(read.effects).toEqual([{ type: "quote.read" }])
    expect(activeQuote(read.state)?.text).toBe("selected text")
  })

  test("a settle timer from before a press is ignored", () => {
    const changed = transitionQuote(createQuoteState(), SELECTION_CHANGED_QUOTE_EVENT).state
    const pressed = transitionQuote(changed, { type: "pointer.down", collapsed: false })
    expect(pressed.effects).toEqual([{ type: "settle.cancel" }, { type: "press.watch" }])
    expect(transitionQuote(pressed.state, { type: "settle.ready", attempt: settleOf(changed) }).state).toBe(
      pressed.state,
    )
  })

  test.each([
    ["a reset", RESET_QUOTE_EVENT],
    ["a new selection", SELECTION_CHANGED_QUOTE_EVENT],
    ["a cleared selection", SELECTION_CLEARED_QUOTE_EVENT],
  ])("the unselectable-press clear is cancelled by %s", (_name, event) => {
    const pressed = transitionQuote(shown(), { type: "pointer.down", collapsed: false, clearRange: selected.range })
    const clear = pressed.state.status === "shown" ? pressed.state.clear : undefined
    expect(clear).toBeDefined()
    expect(pressed.effects).toContainEqual({ type: "clear.schedule", attempt: clear!.attempt })

    const next = transitionQuote(pressed.state, event)
    expect(next.effects).toContainEqual({ type: "clear.cancel" })

    const late = transitionQuote(next.state, { type: "clear.ready", attempt: clear!.attempt })
    expect(late.state).toBe(next.state)
    expect(late.effects).toEqual([])
  })

  test("the unselectable-press clear runs while its press is current", () => {
    const pressed = transitionQuote(shown(), {
      type: "pointer.down",
      collapsed: false,
      clearRange: selected.range,
    }).state

    const clear = pressed.status === "shown" ? pressed.clear! : undefined

    expect(transitionQuote(pressed, { type: "clear.ready", attempt: clear!.attempt }).effects).toEqual([
      { type: "selection.clearIfSame", range: clear!.range },
    ])
  })

  test.each([
    ["a cleared selection", SELECTION_CLEARED_QUOTE_EVENT],
    ["Escape", escape],
    ["a reset", RESET_QUOTE_EVENT],
    ["disposal", DISPOSED_QUOTE_EVENT],
  ])("%s cancels pending place and reflow frames", (_name, event) => {
    const pending = play([VIEWPORT_MOVED_QUOTE_EVENT, ROOT_RESIZED_QUOTE_EVENT], shown()).state
    const next = transitionQuote(pending, event)

    expect(next.effects).toContainEqual({ type: "place.cancel" })
    expect(next.effects).toContainEqual({ type: "reflow.cancel" })
    expect(quoteToolbarView(next.state)).toBeUndefined()
  })

  test("scrolling the selection out of view hides the toolbar and scrolling back restores it", () => {
    const state = shown()
    const moved = transitionQuote(state, VIEWPORT_MOVED_QUOTE_EVENT)
    expect(moved.effects).toEqual([{ type: "place.schedule", attempt: state.attempt }])
    // Further scrolls share the pending frame.
    expect(transitionQuote(moved.state, VIEWPORT_MOVED_QUOTE_EVENT).state).toBe(moved.state)

    const measure = transitionQuote(moved.state, { type: "place.ready", attempt: state.attempt })
    expect(measure.effects).toEqual([{ type: "place.measure", quote: activeQuote(state)! }])

    const away = transitionQuote(measure.state, {
      type: "place.measured",
      collapsed: false,
      placement: { bounds, extent: undefined },
    }).state

    expect(quoteToolbarView(away)).toBeUndefined()
    expect(activeQuote(away)?.text).toBe("selected text")

    const back = transitionQuote(away, { type: "place.measured", collapsed: false, placement: { bounds, extent } })
    expect(quoteToolbarView(back.state)?.extent).toEqual(extent)

    // The virtualizer removed the selected rows.
    expect(transitionQuote(away, { type: "place.measured", collapsed: true, placement: undefined }).state.status).toBe(
      "idle",
    )
  })

  test("Escape keeps the same selection dismissed until it changes or clears", () => {
    const dismissed = transitionQuote(shown(), { type: "escape", range: selected.range, toolbarFocused: true })
    expect(dismissed.state.status).toBe("dismissed")
    expect(dismissed.effects).toEqual([{ type: "focus.root" }])

    const changed = transitionQuote(dismissed.state, SELECTION_CHANGED_QUOTE_EVENT).state
    const read = transitionQuote(changed, { type: "settle.ready", attempt: settleOf(changed) })
    expect(read.effects).toEqual([{ type: "quote.read", dismissed: selected.range }])

    // The browser still holds the dismissed range.
    expect(transitionQuote(read.state, { type: "quote.measured", quote: undefined, dismissed: true }).state).toBe(
      read.state,
    )

    // A different range shows again.
    expect(transitionQuote(read.state, { type: "quote.measured", quote: quote("other text") }).state.status).toBe(
      "shown",
    )
    expect(transitionQuote(dismissed.state, SELECTION_CLEARED_QUOTE_EVENT).state.status).toBe("idle")
  })

  test("a press after the dismissed selection was cleared shows a drag over the same range", () => {
    const dismissed = transitionQuote(shown(), { type: "escape", range: selected.range, toolbarFocused: false }).state

    // The clear's selectionchange is coalesced with the drag's, so the machine only sees the press on nothing.
    const released = play(
      [
        { type: "pointer.down", collapsed: true },
        SELECTION_CHANGED_QUOTE_EVENT,
        { type: "pointer.up", collapsed: false },
      ],
      dismissed,
    ).state

    const read = transitionQuote(released, { type: "settle.ready", attempt: settleOf(released) })
    expect(read.effects).toEqual([{ type: "quote.read" }])

    // A press while the dismissed selection is still there keeps it dismissed.
    const held = transitionQuote(dismissed, { type: "pointer.down", collapsed: false }).state
    expect(held.status).toBe("dismissed")
  })

  test("a resize reads the quote again only once the press is released", () => {
    const state = shown()
    const pressed = transitionQuote(state, { type: "pointer.down", collapsed: false }).state
    expect(transitionQuote(pressed, ROOT_RESIZED_QUOTE_EVENT).state).toBe(pressed)

    const resized = transitionQuote(state, ROOT_RESIZED_QUOTE_EVENT)
    expect(resized.effects).toEqual([{ type: "reflow.schedule", attempt: state.attempt }])
    expect(transitionQuote(resized.state, { type: "reflow.ready", attempt: state.attempt }).effects).toEqual([
      { type: "quote.read" },
    ])
  })

  test("the toolbar stays up while a changed selection settles", () => {
    const changed = transitionQuote(shown(), SELECTION_CHANGED_QUOTE_EVENT).state
    expect(quoteToolbarView(changed)?.text).toBe("selected text")
    expect(activeQuote(select(changed, "longer selected text"))?.text).toBe("longer selected text")
  })

  test("reset from a quiet idle state writes nothing", () => {
    const state = createQuoteState()
    expect(transitionQuote(state, RESET_QUOTE_EVENT).state).toBe(state)
    expect(transitionQuote(state, DISPOSED_QUOTE_EVENT).state).toBe(state)
    expect(transitionQuote(state, SELECTION_CLEARED_QUOTE_EVENT).state).toBe(state)
  })
})
