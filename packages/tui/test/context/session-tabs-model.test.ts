import { describe, expect, test } from "bun:test"
import {
  adaptiveSessionTabLayout,
  closeSessionTab,
  cycleSessionTab,
  openSessionTab,
  sessionTabComplete,
} from "../../src/context/session-tabs-model"

describe("session tabs", () => {
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
