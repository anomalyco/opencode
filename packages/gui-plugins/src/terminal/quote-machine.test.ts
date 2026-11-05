import { describe, expect, test } from "bun:test"
import {
  createQuoteDispatch,
  createQuoteState,
  quotePosition,
  selectQuoteSourcePlace,
  selectQuoteToolbar,
  TERMINAL_QUOTE_GAP,
  TERMINAL_QUOTE_MAX_LENGTH,
  TERMINAL_QUOTE_SETTLE_MS,
  transitionQuote,
  type QuoteEffect,
  type QuoteEvent,
  type QuoteSample,
  type QuoteState,
  type QuoteTransition,
} from "./quote-machine"

const BOUNDS = { top: 0, bottom: 400, left: 0, right: 600, width: 600, height: 400 }

const SAMPLE: QuoteSample = {
  cells: { start: { x: 2, y: 3 }, end: { x: 9, y: 3 } },
  offset: 0,
  written: 3,
  bounds: BOUNDS,
  origin: { top: 0, left: 0 },
  metrics: { width: 10, height: 20 },
}

const SIZE = { width: 68, height: 28 }

// Folds the events in order and returns the last transition.
const replay = (events: readonly QuoteEvent[], state: QuoteState = createQuoteState()) =>
  events.reduce<QuoteTransition>((last, event) => transitionQuote(last.state, event), { state, effects: [] })

const press = (button = 0): QuoteEvent => ({ type: "pointer.down", button })

const released: QuoteEvent = { type: "pointer.released" }

const selected: QuoteEvent = { type: "selection.changed" }

const settled = (attempt: number, text = "quote-me", sample: QuoteSample | undefined = SAMPLE): QuoteEvent => ({
  type: "settle.sampled",
  attempt,
  text,
  sample,
})

const key = (name: string, modified = false): QuoteEvent => ({ type: "key.pressed", key: name, modified })

const scrolled: QuoteEvent = { type: "layout.changed", resized: false }

const resized: QuoteEvent = { type: "layout.changed", resized: true }

const added = (skipComment = false): QuoteEvent => ({ type: "quote.added", skipComment })

const shownState = (events: readonly QuoteEvent[] = [selected, settled(1)]) => {
  const state = replay(events).state

  if (state.status !== "shown") throw new Error(`expected shown, got ${state.status}`)
  return state
}

const measure = (written: number, offset = 0) => () => ({
  offset,
  written,
  bounds: BOUNDS,
  origin: { top: 0, left: 0 },
  metrics: { width: 10, height: 20 },
})

const committed = (effects: readonly QuoteEffect[]) => {
  const effect = effects.find((item) => item.type === "commit-quote")

  if (effect?.type !== "commit-quote") throw new Error("expected commit-quote")
  return effect
}

describe("terminal quote bug replays", () => {
  // `pointerup`, `pointercancel`, `contextmenu` and window `blur` all release the press.
  test("a press that ends without pointerup still settles and shows the selection", () => {
    const pressing = replay([press(), selected])
    expect(pressing.state.status).toBe("pressing")

    const settling = transitionQuote(pressing.state, released)
    expect(settling.state).toMatchObject({ status: "settling", attempt: 1 })
    expect(settling.effects).toEqual([{ type: "schedule-settle", attempt: 1, delayMs: TERMINAL_QUOTE_SETTLE_MS }])
    expect(transitionQuote(settling.state, settled(1)).state).toMatchObject({ status: "shown", text: "quote-me" })
  })

  test("a right click on a shown selection keeps it, and its release changes nothing", () => {
    const shown = shownState()

    expect(transitionQuote(shown, press(2))).toEqual({ state: shown, effects: [] })
    expect(transitionQuote(shown, press(2)).state).toBe(shown)
    expect(transitionQuote(shown, released).state).toBe(shown)
  })

  test("a right click while settling keeps the settle timer", () => {
    const settling = replay([selected]).state

    expect(transitionQuote(settling, press(1)).state).toBe(settling)
    expect(transitionQuote(settling, press(2)).effects).toEqual([])
  })

  test.each<[string, QuoteEvent, QuoteState["status"]]>([
    ["a primary press", press(), "pressing"],
    ["a key", key("a"), "idle"],
    ["a selection change", selected, "settling"],
    ["Quote", added(), "idle"],
    ["unmount", { type: "disposed" }, "disposed"],
  ])("closing with %s cancels a queued placement frame and ignores its late sample", (_, exit, status) => {
    const queued = transitionQuote(shownState(), scrolled)
    expect(queued.effects).toEqual([{ type: "schedule-place", attempt: 2 }])

    const closed = transitionQuote(queued.state, exit)
    expect(closed.state.status).toBe(status)
    expect(closed.effects[0]).toEqual({ type: "cancel-place" })

    const late = transitionQuote(closed.state, { type: "place.sampled", attempt: 2, sample: SAMPLE })
    expect(late.state).toBe(closed.state)
  })

  test("a write or grid resize after the read invalidates the quote's anchor, even before Quote", () => {
    const shown = shownState()
    const source = committed(transitionQuote(shown, added()).effects).source
    expect(source).toEqual({ cells: SAMPLE.cells, offset: 0, written: 3, resized: 0 })
    if (!source) throw new Error("expected a source")

    expect(selectQuoteSourcePlace(shown, source, SIZE, measure(3))).toBeDefined()
    // Output arrived while the toolbar was open.
    expect(selectQuoteSourcePlace(shown, source, SIZE, measure(4))).toBeUndefined()

    // The grid resized while the toolbar was open, then Quote was clicked.
    const after = transitionQuote(transitionQuote(shown, resized).state, added())
    const stale = committed(after.effects).source
    if (!stale) throw new Error("expected a source")
    expect(stale.resized).toBe(0)
    expect(selectQuoteSourcePlace(after.state, stale, SIZE, measure(3))).toBeUndefined()
  })

  test("each open measures the toolbar again", () => {
    const measured = transitionQuote(shownState(), { type: "toolbar.measured", size: SIZE }).state
    expect(selectQuoteToolbar(measured, true)?.measured).toBe(true)

    const reopened = replay([press(), released, settled(2, "x".repeat(TERMINAL_QUOTE_MAX_LENGTH + 1))], measured).state
    expect(reopened).toMatchObject({ status: "shown", truncated: true, toolbarSize: { width: 0, height: 0 } })
    expect(selectQuoteToolbar(reopened, true)?.measured).toBe(false)
  })

  test("a pane narrower than the toolbar pins it to the left edge", () => {
    const bounds = { top: 0, bottom: 400, left: 100, right: 160, width: 60, height: 400 }
    const anchor = { top: 100, bottom: 120, start: 110, end: 150, single: true }

    expect(quotePosition({ width: 190, height: 28 }, bounds, anchor).left).toBe(100 + TERMINAL_QUOTE_GAP)
  })
})

describe("terminal quote transitions", () => {
  test("only the current settle attempt reads the selection", () => {
    const settling = replay([selected, selected])
    expect(settling.state).toMatchObject({ status: "settling", attempt: 2 })

    expect(transitionQuote(settling.state, settled(1)).state).toBe(settling.state)
    expect(transitionQuote(settling.state, settled(2)).state.status).toBe("shown")
  })

  test("scrolls and resizes in one frame queue one placement and still tick", () => {
    const shown = shownState()
    const first = transitionQuote(shown, scrolled)
    const second = transitionQuote(first.state, resized)

    expect(first.effects).toEqual([{ type: "schedule-place", attempt: 2 }])
    expect(second.effects).toEqual([])
    expect(second.state).toMatchObject({ revision: 2, resized: 1, placeAttempt: 2 })

    const placed = transitionQuote(second.state, { type: "place.sampled", attempt: 2, sample: SAMPLE })
    expect(placed.state).toMatchObject({ status: "shown", placeAttempt: undefined })
  })

  test("layout ticks while idle so a retained anchor keeps following the terminal", () => {
    expect(replay([scrolled, resized]).state).toEqual({ status: "idle", issued: 0, revision: 2, resized: 1 })
  })

  test("trims leading blank lines and trailing whitespace but keeps indentation", () => {
    expect(replay([selected, settled(1, "\n\n  indented\n\n  ")]).state).toMatchObject({ text: "  indented" })
    expect(replay([selected, settled(1, "\n   \n")]).state.status).toBe("idle")
    expect(replay([selected, settled(1, "", undefined)]).state.status).toBe("idle")
  })

  test("a truncated selection cannot be quoted", () => {
    const shown = shownState([selected, settled(1, "x".repeat(TERMINAL_QUOTE_MAX_LENGTH + 1))])

    expect(transitionQuote(shown, added())).toEqual({ state: shown, effects: [] })
  })

  test("Quote clears the selection and commits, without an anchor on Alt", () => {
    const shown = shownState()
    const quoted = transitionQuote(shown, added(true))

    expect(quoted.state.status).toBe("idle")
    expect(quoted.effects).toEqual([
      { type: "clear-selection" },
      { type: "commit-quote", text: "quote-me", source: undefined },
    ])
  })

  test("copy shortcuts and modifier keys keep the toolbar; other keys close it", () => {
    const shown = shownState()
    const settling = replay([selected]).state

    ;[key("c", true), key("Shift"), key("Control"), key("Alt"), key("Meta")].forEach((event) => {
      expect(transitionQuote(shown, event).state).toBe(shown)
      expect(transitionQuote(settling, event).state).toBe(settling)
    })
    expect(transitionQuote(shown, key("Escape")).state.status).toBe("idle")
    expect(transitionQuote(settling, key("a"))).toMatchObject({
      state: { status: "idle" },
      effects: [{ type: "cancel-settle" }],
    })

    const idle = createQuoteState()
    expect(transitionQuote(idle, key("a")).state).toBe(idle)
  })

  test("a selection read out of view shows once scrolled into view and keeps its cells", () => {
    const shown = shownState([selected, settled(1, "quote-me", { ...SAMPLE, cells: undefined })])
    expect(shown.placement).toBeUndefined()
    expect(selectQuoteToolbar(shown, true)).toBeUndefined()

    const queued = transitionQuote(shown, scrolled).state
    const visible = transitionQuote(queued, { type: "place.sampled", attempt: 2, sample: { ...SAMPLE, offset: 5 } })
    expect(visible.state).toMatchObject({ source: { cells: SAMPLE.cells, offset: 5 } })
    expect(selectQuoteToolbar(visible.state, true)).toBeDefined()
    expect(selectQuoteToolbar(visible.state, false)).toBeUndefined()
  })

  test("a placement frame that finds the selection cleared closes the toolbar", () => {
    const queued = transitionQuote(shownState(), scrolled).state

    expect(transitionQuote(queued, { type: "place.sampled", attempt: 2, sample: undefined }).state.status).toBe("idle")
  })

  test("the anchor follows scrolling", () => {
    const shown = shownState()
    const source = committed(transitionQuote(shown, added()).effects).source
    if (!source) throw new Error("expected a source")

    // Two rows scrolled back: the selection is two rows lower.
    expect(selectQuoteSourcePlace(shown, source, SIZE, measure(3, -2))).toEqual(
      quotePosition(SIZE, BOUNDS, { top: 100, bottom: 120, start: 20, end: 100, single: true }),
    )
  })

  test.each<[string, readonly QuoteEvent[], readonly QuoteEffect[]]>([
    ["idle", [], []],
    ["pressing", [press()], []],
    ["settling", [selected], [{ type: "cancel-settle" }]],
    ["shown", [selected, settled(1)], []],
    ["placing", [selected, settled(1), scrolled], [{ type: "cancel-place" }]],
  ])("disposing while %s cancels its handles and ignores everything after", (_, events, effects) => {
    const disposed = transitionQuote(replay(events).state, { type: "disposed" })
    const source = { cells: SAMPLE.cells, offset: 0, written: 3, resized: 0 }

    expect(disposed).toEqual({ state: { status: "disposed" }, effects })
    expect(selectQuoteSourcePlace(disposed.state, source, SIZE, measure(3))).toBeUndefined()
    ;[press(), released, selected, settled(1), scrolled, added()].forEach((event) => {
      expect(transitionQuote(disposed.state, event).state).toBe(disposed.state)
    })
  })
})

describe("terminal quote dispatch", () => {
  test("events dispatched by an effect apply after the current one, and ignored events write nothing", () => {
    const written: QuoteState["status"][] = []
    const effects: QuoteEffect["type"][] = []
    let current = createQuoteState()
    const dispatch: (event: QuoteEvent) => void = createQuoteDispatch({
      read: () => current,
      write: (state) => {
        current = state
        written.push(state.status)
      },
      run: (effect) => {
        effects.push(effect.type)
        // ghostty-web may announce the cleared selection synchronously.
        if (effect.type === "clear-selection") dispatch(selected)
      },
    })

    dispatch(selected)
    dispatch(settled(1))
    dispatch(key("Shift"))
    dispatch(released)
    expect(written).toEqual(["settling", "shown"])

    dispatch(added())
    expect(written).toEqual(["settling", "shown", "idle", "settling"])
    expect(effects).toEqual(["schedule-settle", "clear-selection", "commit-quote", "schedule-settle"])

    dispatch(settled(2, "", undefined))
    expect(current.status).toBe("idle")
  })
})
