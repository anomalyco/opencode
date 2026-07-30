import { describe, expect, test } from "bun:test"
import {
  adaptiveSessionTabLayout,
  closeSessionTab,
  cycleSessionTab,
  moveSessionTab,
  moveSessionTabHistory,
  openSessionTab,
  recordSessionTabHistory,
  seedSessionTabMotion,
  sessionTabComplete,
  sessionTabOverflowWidth,
} from "../../src/context/session-tabs-model"

describe("session tabs", () => {
  test("moves a tab to a clamped index and returns the same tabs for no-ops", () => {
    const tabs = ["a", "b", "c"].map((sessionID) => ({ sessionID }))
    expect(moveSessionTab(tabs, "a", 2).map((tab) => tab.sessionID)).toEqual(["b", "c", "a"])
    expect(moveSessionTab(tabs, "c", -5).map((tab) => tab.sessionID)).toEqual(["c", "a", "b"])
    expect(moveSessionTab(tabs, "b", 99).map((tab) => tab.sessionID)).toEqual(["a", "c", "b"])
    expect(moveSessionTab(tabs, "b", 1)).toBe(tabs)
    expect(moveSessionTab(tabs, "missing", 0)).toBe(tabs)
  })

  test("open seeding keeps survivors and grows the new tab from zero", () => {
    const seeded = seedSessionTabMotion(
      ["a", "b"],
      ["a", "b", "c"],
      { widths: [35, 35], selections: [1, 0], activities: [0, 1] },
      { widths: [24, 23, 23], selections: [1, 0, 0], activities: [0, 1, 0] },
    )
    expect(seeded).toEqual({ widths: [35, 35, 0], selections: [1, 0, 0], activities: [0, 1, 0] })
  })

  test("close seeding keeps survivors at their current animated widths", () => {
    const seeded = seedSessionTabMotion(
      ["a", "b", "c"],
      ["a", "c"],
      { widths: [24, 23, 23], selections: [1, 0, 0], activities: [0, 0, 1] },
      { widths: [35, 35], selections: [1, 0], activities: [0, 1] },
    )
    expect(seeded).toEqual({ widths: [24, 23], selections: [1, 0], activities: [0, 1] })
  })

  test("window shifts keep retained tabs and grow revealed ones", () => {
    const seeded = seedSessionTabMotion(
      ["a", "b", "c"],
      ["b", "c", "d"],
      { widths: [22, 8, 8], selections: [1, 0, 0], activities: [0, 0, 0] },
      { widths: [8, 8, 22], selections: [0, 0, 1], activities: [0, 0, 0] },
    )
    expect(seeded).toEqual({ widths: [8, 8, 0], selections: [0, 0, 1], activities: [0, 0, 0] })
  })

  test("fully replaced windows jump instead of seeding", () => {
    const values = { widths: [22], selections: [1], activities: [0] }
    expect(seedSessionTabMotion(["a"], ["z"], values, values)).toBeUndefined()
  })

  test("overflow markers reserve room for a gap beside their digits", () => {
    expect(sessionTabOverflowWidth(5)).toBe(3)
    expect(sessionTabOverflowWidth(12)).toBe(4)
  })

  test("opens each session once and refreshes its title", () => {
    const tabs = openSessionTab([{ sessionID: "a", title: "Old" }], { sessionID: "a", title: "New" })
    expect(tabs).toEqual([{ sessionID: "a", title: "New" }])
    expect(openSessionTab(tabs, { sessionID: "b" })).toEqual([{ sessionID: "a", title: "New" }, { sessionID: "b" }])
    expect(openSessionTab(tabs, { sessionID: "a", title: "New" })).toBe(tabs)
  })

  test("selects the right tab then the left tab after closing", () => {
    expect(closeSessionTab([{ sessionID: "a" }, { sessionID: "b" }, { sessionID: "c" }], "b")).toEqual({
      tabs: [{ sessionID: "a" }, { sessionID: "c" }],
      next: "c",
    })
    expect(closeSessionTab([{ sessionID: "a" }, { sessionID: "b" }], "b").next).toBe("a")
    expect(closeSessionTab([{ sessionID: "a" }], "a").next).toBeUndefined()
  })

  test("cycles through a filtered tab set in either direction", () => {
    const tabs = ["a", "c", "e"].map((sessionID) => ({ sessionID }))
    expect(cycleSessionTab(tabs, "c", 1)?.sessionID).toBe("e")
    expect(cycleSessionTab(tabs, "c", -1)?.sessionID).toBe("a")
    expect(cycleSessionTab(tabs, "e", 1)?.sessionID).toBe("a")
    expect(cycleSessionTab(tabs, "b", 1)?.sessionID).toBe("a")
  })

  test("moves backward and forward through selection history", () => {
    const tabs = ["a", "b", "c", "d"].map((sessionID) => ({ sessionID }))
    const history = ["a", "b", "c", "d"].reduce(recordSessionTabHistory, { entries: [], index: -1 })
    const backToC = moveSessionTabHistory(history, tabs, "d", -1)
    const backToB = moveSessionTabHistory(backToC.history, tabs, "c", -1)
    const forwardToC = moveSessionTabHistory(backToB.history, tabs, "b", 1)
    const forwardToD = moveSessionTabHistory(forwardToC.history, tabs, "c", 1)

    expect([backToC.sessionID, backToB.sessionID, forwardToC.sessionID, forwardToD.sessionID]).toEqual([
      "c",
      "b",
      "c",
      "d",
    ])
  })

  test("truncates forward history after a new selection", () => {
    const tabs = ["a", "b", "c", "d"].map((sessionID) => ({ sessionID }))
    const history = ["a", "b", "c"].reduce(recordSessionTabHistory, { entries: [], index: -1 })
    const back = moveSessionTabHistory(history, tabs, "c", -1)
    const branched = recordSessionTabHistory(back.history, "d")

    expect(branched).toEqual({ entries: ["a", "b", "d"], index: 2 })
    expect(moveSessionTabHistory(branched, tabs, "d", 1).sessionID).toBeUndefined()
  })

  test("skips closed tabs and duplicate entries for the active tab", () => {
    const tabs = ["a", "b"].map((sessionID) => ({ sessionID }))
    const history = ["a", "b", "c", "b"].reduce(recordSessionTabHistory, { entries: [], index: -1 })

    expect(moveSessionTabHistory(history, tabs, "b", -1).sessionID).toBe("a")
    expect(recordSessionTabHistory(history, "b")).toBe(history)
  })

  test("returns to the latest history entry when no tab is active", () => {
    const tabs = ["a", "b"].map((sessionID) => ({ sessionID }))
    const history = ["a", "b"].reduce(recordSessionTabHistory, { entries: [], index: -1 })

    expect(moveSessionTabHistory(history, tabs, undefined, -1).sessionID).toBe("b")
  })

  test("returns to the previous selected open tab after closing the active tab", () => {
    const tabs = ["a", "b", "c"].map((sessionID) => ({ sessionID }))
    const history = ["a", "c"].reduce(recordSessionTabHistory, { entries: [], index: -1 })
    const closed = closeSessionTab(tabs, "b")
    const current = recordSessionTabHistory(history, "b")

    expect(moveSessionTabHistory(current, closed.tabs, "b", -1).sessionID).toBe("c")
  })

  test("reveals completion activity only after session work becomes idle", () => {
    expect(sessionTabComplete("activity", true)).toBe(false)
    expect(sessionTabComplete("activity", false)).toBe(true)
    expect(sessionTabComplete("error", false)).toBe(false)
  })

  test("expands the active tab and keeps inactive widths equal", () => {
    const tabs = ["a", "b", "c", "d", "e", "f", "g"].map((sessionID) => ({ sessionID }))
    const layout = adaptiveSessionTabLayout(tabs, "d", 76)

    expect(layout).toMatchObject({ before: 0, after: 0, start: 0, total: 76 })
    expect(layout.widths).toEqual([9, 9, 9, 22, 9, 9, 9])
    expect(layout.widths.reduce((total, width) => total + width, 0)).toBe(76)
  })

  test("reserves an active tab slot for the new session page", () => {
    const tabs = ["a", "b", "c", "d", "new"].map((sessionID) => ({ sessionID }))
    const layout = adaptiveSessionTabLayout(tabs, "new", 54)

    expect(layout.tabs).toEqual(tabs)
    expect(layout.widths).toEqual([8, 8, 8, 8, 22])
    expect(layout.widths.reduce((total, width) => total + width, 0)).toBe(layout.total)
  })

  test("keeps the visible tab window stable on the new session page", () => {
    const tabs = Array.from({ length: 10 }, (_, index) => ({ sessionID: String(index) }))
    const selected = adaptiveSessionTabLayout(tabs, "7", 70)
    const home = adaptiveSessionTabLayout(tabs, undefined, 70, selected.start)

    expect(selected.start).toBeGreaterThan(0)
    expect(home.start).toBe(selected.start)
  })

  test("only swaps old and new active width inside a sticky window", () => {
    const tabs = ["a", "b", "c", "d", "e", "f", "g"].map((sessionID) => ({ sessionID }))
    const before = adaptiveSessionTabLayout(tabs, "c", 76)
    const after = adaptiveSessionTabLayout(tabs, "d", 76, before.start)

    expect(before.start).toBe(after.start)
    expect(before.widths).toEqual([9, 9, 22, 9, 9, 9, 9])
    expect(after.widths).toEqual([9, 9, 9, 22, 9, 9, 9])
  })

  test("shares roomy width equally without changing widths on selection", () => {
    const tabs = ["a", "b", "c"].map((sessionID) => ({ sessionID }))
    const before = adaptiveSessionTabLayout(tabs, "a", 100)
    const after = adaptiveSessionTabLayout(tabs, "c", 100, before.start)

    expect(before.widths).toEqual([32, 32, 32])
    expect(after.widths).toEqual(before.widths)
    expect(before.total).toBe(96)
  })

  test("caps a single tab instead of stretching it across the terminal", () => {
    const layout = adaptiveSessionTabLayout([{ sessionID: "a" }], "a", 100)

    expect(layout.widths).toEqual([32])
    expect(layout.total).toBe(32)
  })

  test("fills roomy space equally below the maximum width", () => {
    const tabs = ["a", "b", "c", "d"].map((sessionID) => ({ sessionID }))

    expect(adaptiveSessionTabLayout(tabs, "b", 100).widths).toEqual([25, 25, 25, 25])
  })

  test("expands only the active tab under compact pressure", () => {
    const tabs = ["a", "b", "c", "d", "e"].map((sessionID) => ({ sessionID }))
    const before = adaptiveSessionTabLayout(tabs, "c", 100)
    const after = adaptiveSessionTabLayout(tabs, "d", 100, before.start)

    expect(before.widths).toEqual([19, 19, 24, 19, 19])
    expect(after.widths).toEqual([19, 19, 19, 24, 19])
  })

  test("moves the window only after selection crosses its edge", () => {
    const tabs = Array.from({ length: 10 }, (_, index) => ({ sessionID: String(index) }))
    const initial = adaptiveSessionTabLayout(tabs, "3", 70)
    const inside = adaptiveSessionTabLayout(tabs, "4", 70, initial.start)
    const crossed = adaptiveSessionTabLayout(tabs, "7", 70, inside.start)

    expect(initial.start).toBe(0)
    expect(inside.start).toBe(0)
    expect(crossed.start).toBeGreaterThan(0)
    expect(crossed.tabs.some((tab) => tab.sessionID === "7")).toBe(true)
    expect(crossed.widths.reduce((total, width) => total + width, 0)).toBe(crossed.total)
  })
})
