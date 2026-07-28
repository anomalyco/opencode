import { describe, expect, test } from "bun:test"
import { closeSessionTab, openSessionTab, visibleSessionTabs } from "../../src/context/session-tabs-model"

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

  test("keeps the active tab in a bounded visible window", () => {
    const tabs = ["a", "b", "c", "d", "e"].map((sessionID) => ({ sessionID }))
    expect(visibleSessionTabs(tabs, "d", 3).map((tab) => tab.sessionID)).toEqual(["c", "d", "e"])
    expect(visibleSessionTabs(tabs, "a", 3).map((tab) => tab.sessionID)).toEqual(["a", "b", "c"])
  })
})
