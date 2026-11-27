import { describe, expect, test } from "bun:test"
import {
  PICKER_FOCUS_TIMEOUT_MS,
  PICKER_MAX_SESSIONS,
  createPickerState,
  pickerBrowsing,
  pickerFilterText,
  pickerFocusRequest,
  transitionPicker,
  type PickerEvent,
  type PickerState,
  type PickerTransition,
} from "./picker-machine"

const opened = (sessionKey: string, tabId: string, background = false): PickerEvent => ({
  type: "picker.opened",
  sessionKey,
  query: "",
  target: { kind: "launcher", tabId },
  background,
})

const openedMobile: PickerEvent = {
  type: "picker.opened",
  sessionKey: "sA",
  query: "",
  target: { kind: "mobile" },
  background: false,
}

// Folds the events in order and returns the last transition.
const replay = (events: readonly PickerEvent[], state: PickerState = createPickerState()) =>
  events.reduce<PickerTransition>((last, event) => transitionPicker(last.state, event), { state, effects: [] })

describe("transitionPicker", () => {
  test("a focus request belongs to its session's launcher only, never another session, tab, pane or hidden view", () => {
    const result = replay([opened("sA", "open:1")])

    expect(result.effects).toEqual([{ type: "start-focus-timer", request: 1, timeoutMs: PICKER_FOCUS_TIMEOUT_MS }])

    const view = { placement: "side", sessionKey: "sA", tabId: "open:1", visible: true } as const

    expect(pickerFocusRequest(result.state, view)).toBe(1)
    expect(pickerFocusRequest(result.state, { ...view, sessionKey: "sB" })).toBeUndefined()
    expect(pickerFocusRequest(result.state, { ...view, tabId: "//README.md" })).toBeUndefined()
    expect(pickerFocusRequest(result.state, { ...view, tabId: "open:2" })).toBeUndefined()
    expect(pickerFocusRequest(result.state, { ...view, visible: false })).toBeUndefined()
    expect(
      pickerFocusRequest(result.state, { placement: "mobile", sessionKey: "sA", browsing: true, visible: true }),
    ).toBeUndefined()
  })

  test("a narrow-screen request belongs to the mobile view while it browses", () => {
    const result = replay([openedMobile])
    const view = { placement: "mobile", sessionKey: "sA", browsing: true, visible: true } as const

    expect(pickerFocusRequest(result.state, view)).toBe(1)
    expect(pickerFocusRequest(result.state, { ...view, browsing: false })).toBeUndefined()
    expect(
      pickerFocusRequest(result.state, { placement: "side", sessionKey: "sA", tabId: "open", visible: true }),
    ).toBeUndefined()
  })

  test.each<[string, PickerEvent]>([
    ["closing its launcher", { type: "launcher.closed", sessionKey: "sA", tabId: "open:1" }],
    ["opening a file", { type: "file.opened", sessionKey: "sA" }],
    ["the input taking focus", { type: "focus.ended", request: 1 }],
  ])("%s ends the focus request", (_, event) => {
    const result = replay([opened("sA", "open:1"), event])

    expect(result.effects).toEqual([{ type: "cancel-focus-timer" }])
    expect(
      pickerFocusRequest(result.state, { placement: "side", sessionKey: "sA", tabId: "open:1", visible: true }),
    ).toBeUndefined()
  })

  test("leaving the narrow-screen browse view ends its focus request", () => {
    const result = replay([openedMobile, { type: "browsing.set", sessionKey: "sA", browsing: false }])

    expect(result.effects).toEqual([{ type: "cancel-focus-timer" }])
    expect(result.state).toMatchObject({ focus: { status: "none" } })
  })

  test("events for another session, launcher or request leave the focus request alone", () => {
    const start = replay([opened("sA", "open:1")])

    for (const event of [
      { type: "launcher.closed", sessionKey: "sA", tabId: "open:2" },
      { type: "launcher.closed", sessionKey: "sB", tabId: "open:1" },
      { type: "file.opened", sessionKey: "sB" },
      { type: "focus.ended", request: 7 },
      { type: "browsing.set", sessionKey: "sA", browsing: false },
    ] satisfies PickerEvent[]) {
      const result = transitionPicker(start.state, event)

      expect(result.effects).toEqual([])
      expect(
        pickerFocusRequest(result.state, { placement: "side", sessionKey: "sA", tabId: "open:1", visible: true }),
      ).toBe(1)
    }
  })

  test("a file the user selects on a wide screen leaves the browse view for narrow screens too", () => {
    const browsing = replay([opened("sA", "open:1")])

    expect(pickerBrowsing(browsing.state, "sA")).toBe(true)

    const selected = transitionPicker(browsing.state, { type: "file.opened", sessionKey: "sA" })

    expect(pickerBrowsing(selected.state, "sA")).toBe(false)
  })

  test("a background open requests no focus and ends the session's earlier request", () => {
    const result = replay([opened("sA", "open:1"), opened("sA", "open:2", true)])

    expect(result.effects).toEqual([{ type: "cancel-focus-timer" }])
    expect(result.state).toMatchObject({ focus: { status: "none" } })
    expect(pickerBrowsing(result.state, "sA")).toBe(true)
  })

  test("a newer request replaces the older one", () => {
    const result = replay([opened("sA", "open:1"), opened("sB", "open:2")])
    const view = { placement: "side", sessionKey: "sB", tabId: "open:2", visible: true } as const

    expect(pickerFocusRequest(result.state, view)).toBe(2)
    expect(transitionPicker(result.state, { type: "focus.ended", request: 1 }).state).toBe(result.state)
  })

  test("filters keep the newest sessions and drop the ones with nothing to remember", () => {
    const sessions = Array.from({ length: PICKER_MAX_SESSIONS + 1 }, (_, index) => `s${index}`)

    const result = replay(
      sessions.map((sessionKey): PickerEvent => ({ type: "filter.changed", sessionKey, text: "query" })),
    )

    expect(pickerFilterText(result.state, "s0")).toBe("")
    expect(pickerFilterText(result.state, "s1")).toBe("query")
    expect(pickerFilterText(result.state, `s${PICKER_MAX_SESSIONS}`)).toBe("query")
    expect(result.state.status === "active" && Object.keys(result.state.filters).length).toBe(PICKER_MAX_SESSIONS)

    const cleared = transitionPicker(result.state, { type: "filter.changed", sessionKey: "s1", text: "" })

    expect(cleared.state.status === "active" && "s1" in cleared.state.filters).toBe(false)
    expect(transitionPicker(cleared.state, { type: "filter.changed", sessionKey: "s2", text: "query" }).state).toBe(
      cleared.state,
    )
  })

  test("disposal ends the focus timer and ignores everything after it", () => {
    const disposed = replay([opened("sA", "open:1"), { type: "disposed" }])

    expect(disposed).toEqual({ state: { status: "disposed" }, effects: [{ type: "cancel-focus-timer" }] })
    expect(transitionPicker(disposed.state, opened("sA", "open:2")).state).toBe(disposed.state)
    expect(pickerFilterText(disposed.state, "sA")).toBe("")
  })
})
