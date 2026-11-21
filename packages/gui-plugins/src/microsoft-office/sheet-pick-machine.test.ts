import { describe, expect, test } from "bun:test"
import {
  DISPOSED_SHEET_PICK_STATE,
  SHEET_SHOW_TIMEOUT_MS,
  createSheetPickState,
  sheetActiveTab,
  sheetShown,
  sheetShownIndex,
  transitionSheetPick,
  type SheetPickEvent,
  type SheetPickState,
  type SheetPickTransition,
} from "./sheet-pick-machine"
import type { SheetLayout } from "./sheet-protocol"

const layout = (sheet: number): SheetLayout => ({
  info: {
    sheetIds: ["a", "b", "c"],
    sheetNames: ["One", "Two", "Three"],
    activeSheet: sheet,
    contentWidth: 1000,
    contentHeight: 1000,
    frozenRows: 0,
    frozenCols: 0,
    initialScrollX: 0,
    initialScrollY: 0,
  },
  used: undefined,
  merges: [],
  hidden: { rows: [], columns: [] },
  chartWidth: 0,
  chartHeight: 0,
})

const pick = (sheet: number, target?: { row: number; col: number }): SheetPickEvent => ({
  type: "sheet.picked",
  sheet,
  target,
})

// Folds the events in order and returns the last transition.
const replay = (events: readonly SheetPickEvent[], state: SheetPickState = createSheetPickState(layout(0))) =>
  events.reduce<SheetPickTransition>((last, event) => transitionSheetPick(last.state, event), { state, effects: [] })

describe("transitionSheetPick", () => {
  test("a pick opens the sheet in the worker while the sheet on show stays", () => {
    const initial = createSheetPickState(layout(0))
    const next = transitionSheetPick(initial, pick(1))

    expect(next.effects).toEqual([{ type: "request-show", attempt: 1, sheet: 1, timeoutMs: SHEET_SHOW_TIMEOUT_MS }])
    expect(sheetActiveTab(next.state)).toBe(1)
    expect(sheetShown(next.state)).toBe(sheetShown(initial))

    const shown = transitionSheetPick(next.state, { type: "show.succeeded", attempt: 1, layout: layout(1) })

    expect(sheetShownIndex(shown.state)).toBe(1)
    expect(sheetActiveTab(shown.state)).toBe(1)
    expect(shown.effects).toEqual([])
  })

  test("picking the tab already selected changes nothing", () => {
    const initial = createSheetPickState(layout(0))

    expect(transitionSheetPick(initial, pick(0)).state).toBe(initial)

    const selecting = transitionSheetPick(initial, pick(1)).state

    expect(transitionSheetPick(selecting, pick(1))).toEqual({ state: selecting, effects: [] })
  })

  // Bug: a reply that had already settled when the user picked back ran its `.then` with no attempt check, and replaced
  // the sheet on show or toasted.
  test("a late reply after picking back to the sheet on show changes nothing", () => {
    const initial = createSheetPickState(layout(0))
    const back = replay([pick(1), pick(0)], initial)

    expect(back.effects).toEqual([{ type: "abort-show", attempt: 1 }])
    expect(sheetShown(back.state)).toBe(sheetShown(initial))
    expect(sheetActiveTab(back.state)).toBe(0)

    const late = transitionSheetPick(back.state, { type: "show.succeeded", attempt: 1, layout: layout(1) })

    expect(late).toEqual({ state: back.state, effects: [] })
    expect(transitionSheetPick(back.state, { type: "show.failed", attempt: 1, closed: false })).toEqual({
      state: back.state,
      effects: [],
    })
  })

  // Bug: the superseded pick's failure cleared the newer pick's selection and toasted.
  test("a newer pick withdraws the older one, whose late replies change nothing", () => {
    const third = replay([pick(1), pick(2)])

    expect(third.effects).toEqual([
      { type: "abort-show", attempt: 1 },
      { type: "request-show", attempt: 2, sheet: 2, timeoutMs: SHEET_SHOW_TIMEOUT_MS },
    ])

    const failed = transitionSheetPick(third.state, { type: "show.failed", attempt: 1, closed: false })

    expect(failed).toEqual({ state: third.state, effects: [] })
    expect(sheetActiveTab(failed.state)).toBe(2)

    const succeeded = transitionSheetPick(third.state, { type: "show.succeeded", attempt: 1, layout: layout(1) })

    expect(succeeded.state).toBe(third.state)
  })

  // Bug: a stopped worker left the picked tab selected over the previous sheet's grid.
  test("a stopped worker returns the tabs to the sheet on show without a second notice", () => {
    const closed = replay([pick(1), { type: "show.failed", attempt: 1, closed: true }])

    expect(closed.effects).toEqual([])
    expect(closed.state.status).toBe("showing")
    expect(sheetActiveTab(closed.state)).toBe(0)
  })

  test("a sheet that fails to open leaves the sheet on show, with a notice", () => {
    const failed = replay([pick(1), { type: "show.failed", attempt: 1, closed: false }])

    expect(failed.effects).toEqual([{ type: "notify-open-failed" }])
    expect(sheetActiveTab(failed.state)).toBe(0)
  })

  test("a show that hangs times out, is withdrawn, and leaves the sheet on show", () => {
    const timed = replay([pick(1), { type: "show.timed-out", attempt: 1 }])

    expect(timed.effects).toEqual([{ type: "abort-show", attempt: 1 }, { type: "notify-open-failed" }])
    expect(sheetActiveTab(timed.state)).toBe(0)
    expect(transitionSheetPick(timed.state, { type: "show.timed-out", attempt: 1 }).effects).toEqual([])
  })

  test("a link's cell rides along with the show that already runs", () => {
    const selecting = replay([pick(1)]).state
    const linked = transitionSheetPick(selecting, pick(1, { row: 4, col: 2 }))

    expect(linked.effects).toEqual([])

    const shown = transitionSheetPick(linked.state, { type: "show.succeeded", attempt: 1, layout: layout(1) })

    expect(sheetShown(shown.state)?.target).toEqual({ row: 4, col: 2 })
  })

  test("a link to a cell on the sheet on show mounts it afresh at that cell without the worker", () => {
    const initial = createSheetPickState(layout(0))
    const linked = transitionSheetPick(initial, pick(0, { row: 3, col: 1 }))

    expect(linked.effects).toEqual([])
    expect(sheetShown(linked.state)).not.toBe(sheetShown(initial))
    expect(sheetShown(linked.state)?.target).toEqual({ row: 3, col: 1 })
    expect(sheetShown(linked.state)?.layout).toBe(sheetShown(initial)?.layout)
  })

  test("disposal withdraws a running pick and ignores late replies", () => {
    const disposed = replay([pick(1), { type: "disposed" }])

    expect(disposed.state).toBe(DISPOSED_SHEET_PICK_STATE)
    expect(disposed.effects).toEqual([{ type: "abort-show", attempt: 1 }])
    expect(sheetShown(disposed.state)).toBeUndefined()

    const late = transitionSheetPick(disposed.state, { type: "show.failed", attempt: 1, closed: false })

    expect(late).toEqual({ state: DISPOSED_SHEET_PICK_STATE, effects: [] })
    expect(transitionSheetPick(createSheetPickState(layout(0)), { type: "disposed" }).effects).toEqual([])
  })
})
