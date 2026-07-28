import { describe, expect, test } from "bun:test"
import {
  adaptiveSessionTabLayout,
  closeSessionTab,
  cycleSessionTab,
  openSessionTab,
  sessionTabWindow,
} from "../../src/context/session-tabs-model"

describe("session tabs", () => {
  test("opens each session once and refreshes its title", () => {
    const tabs = openSessionTab([{ sessionID: "a", title: "Old" }], { sessionID: "a", title: "New" })
    expect(tabs).toEqual([{ sessionID: "a", title: "New" }])
    expect(openSessionTab(tabs, { sessionID: "b" })).toEqual([{ sessionID: "a", title: "New" }, { sessionID: "b" }])
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

  test("keeps the active tab in a bounded visible window", () => {
    const tabs = ["a", "b", "c", "d", "e"].map((sessionID) => ({ sessionID }))
    expect(sessionTabWindow(tabs, "c", 3)).toEqual({
      tabs: [{ sessionID: "b" }, { sessionID: "c" }, { sessionID: "d" }],
      before: 1,
      after: 1,
    })
    expect(sessionTabWindow(tabs, "a", 3)).toEqual({
      tabs: [{ sessionID: "a" }, { sessionID: "b" }, { sessionID: "c" }],
      before: 0,
      after: 2,
    })
    expect(sessionTabWindow(tabs, "e", 2)).toEqual({
      tabs: [{ sessionID: "d" }, { sessionID: "e" }],
      before: 3,
      after: 0,
    })
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

  test("fills extra room by extending the active tab to the right edge", () => {
    const tabs = ["a", "b", "c"].map((sessionID) => ({ sessionID }))
    const layout = adaptiveSessionTabLayout(tabs, "c", 100)

    expect(layout.widths).toEqual([22, 22, 56])
    expect(layout.widths.reduce((total, width) => total + width, 0)).toBe(100)
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
