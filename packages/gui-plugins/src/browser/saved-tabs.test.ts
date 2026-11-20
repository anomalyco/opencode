import { describe, expect, test } from "bun:test"
import { Schema } from "effect"
import { forgetTabs, SavedTabs, savedTab, saveTabs, tabTitle } from "./saved-tabs"

const page = (id: string, title = "", url = `https://${id}.example/`) => ({ id, url, title })

const empty: SavedTabs = { sessions: [] }

// The tabs after each inventory in turn; an inventory that changes nothing leaves them as they are.
const after = (...inventories: [session: string, tabs: ReturnType<typeof page>[]][]) =>
  inventories.reduce((saved, [session, tabs]) => saveTabs(saved, session, tabs) ?? saved, empty)

describe("saved browser tabs", () => {
  // The desktop restores a tab without loading its page, so the tab reports no title until the person shows it. The
  // strip drew such a tab by its address after every restart.
  test("a restored tab that reports no title keeps the title saved for the same address", () => {
    const saved = after(["s", [page("a", "A"), page("b", "B")]])
    const restored = after(["s", [page("a", "A"), page("b", "B")]], ["s", [page("a"), page("b", "", "https://other.example/")]])

    expect(savedTab(restored, "s", "a")).toEqual({ id: "a", url: "https://a.example/", title: "A" })
    // Another address is another page: the old title is not its title.
    expect(savedTab(restored, "s", "b")).toEqual({ id: "b", url: "https://other.example/" })
    expect(tabTitle(page("a"), savedTab(saved, "s", "a"))).toBe("A")
    expect(tabTitle(page("a", "", "https://other.example/"), savedTab(saved, "s", "a"))).toBeUndefined()
    // An inventory that repeats the saved tabs writes nothing.
    expect(saveTabs(saved, "s", [page("a"), page("b", "B")])).toBeUndefined()
  })

  test("a closed tab, a session without tabs and a removed session leave the store", () => {
    const saved = after(["s", [page("a", "A"), page("b", "B")]], ["t", [page("c", "C")]])

    expect(after(["s", [page("a", "A"), page("b", "B")]], ["s", [page("b", "B")]]).sessions).toEqual([
      { session: "s", tabs: [{ id: "b", url: "https://b.example/", title: "B" }] },
    ])
    expect(saveTabs(saved, "t", [])?.sessions.map((item) => item.session)).toEqual(["s"])
    expect(forgetTabs(saved, "s")?.sessions.map((item) => item.session)).toEqual(["t"])
    expect(forgetTabs(saved, "other")).toBeUndefined()
  })

  test("the session saved last leads, and the oldest leaves past the limit", () => {
    const sessions = Array.from({ length: 51 }, (_, index): [string, ReturnType<typeof page>[]] => [
      `s${index}`,
      [page("a", "A")],
    ])

    const saved = after(...sessions, ["s1", [page("a", "A2")]])

    expect(saved.sessions).toHaveLength(50)
    expect(saved.sessions[0]?.session).toBe("s1")
    expect(savedTab(saved, "s0", "a")).toBeUndefined()
  })

  // The stored shape is the contract with every earlier launch: a record written without a title must still load.
  test("a stored tab without a title loads and has no title to draw", () => {
    const stored = Schema.decodeUnknownSync(SavedTabs)({
      sessions: [{ session: "s", tabs: [{ id: "a", url: "https://a.example/" }] }],
    })

    expect(savedTab(stored, "s", "a")).toEqual({ id: "a", url: "https://a.example/" })
  })
})
