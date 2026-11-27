import { describe, expect, test } from "bun:test"
import { Schema } from "effect"
import { forgetTabs, SavedTabs, savedTab, saveIcon, saveTabs, tabIcon, tabTitle } from "./saved-tabs"

const page = (id: string, title = "", url = `https://${id}.example/`, loading = false) => ({ id, url, title, loading })

const empty: SavedTabs = { sessions: [] }

const icon = "data:image/png;base64,AA"

// The tabs after each inventory in turn; an inventory that changes nothing leaves them as they are.
const after = (...inventories: [session: string, tabs: ReturnType<typeof page>[]][]) =>
  inventories.reduce((saved, [session, tabs]) => saveTabs(saved, session, tabs) ?? saved, empty)

describe("saved browser tabs", () => {
  // The desktop restores a tab without loading its page, so the tab reports no title until its document names itself.
  // The strip drew such a tab by its address, then by its title: its width changed while it loaded.
  test("a restored tab that reports no title keeps the saved one, also while it loads at a redirected address", () => {
    const saved = after(["s", [page("a", "A"), page("b", "B")]])
    const kept = savedTab(saved, "s", "a")

    // Unloaded, loading at its address, and loading where that address redirected to.
    expect(tabTitle(page("a"), kept)).toBe("A")
    expect(tabTitle(page("a", "", "https://a.example/", true), kept)).toBe("A")
    expect(tabTitle(page("a", "", "https://a.example/login", true), kept)).toBe("A")
    // The document's own title wins, and another address that is not loading is another page.
    expect(tabTitle(page("a", "Real"), kept)).toBe("Real")
    expect(tabTitle(page("a", "", "https://other.example/"), kept)).toBeUndefined()

    const restored = after(
      ["s", [page("a", "A"), page("b", "B")]],
      ["s", [page("a", "", "https://a.example/login", true), page("b", "", "https://other.example/")]],
    )

    expect(savedTab(restored, "s", "a")).toEqual({ id: "a", url: "https://a.example/login", title: "A" })
    expect(savedTab(restored, "s", "b")).toEqual({ id: "b", url: "https://other.example/" })
    // An inventory that repeats the saved tabs writes nothing.
    expect(saveTabs(saved, "s", [page("a"), page("b", "B")])).toBeUndefined()
  })

  // A page reports its icon after its inventory, and none while it loads. The strip drew the globe meanwhile.
  test("a tab keeps its saved icon on the same site until its page reports another", () => {
    const saved = saveIcon(after(["s", [page("a", "A")]]), "s", "a", icon) ?? empty
    const kept = savedTab(saved, "s", "a")

    expect(kept?.icon).toBe(icon)
    expect(tabIcon(page("a"), undefined, kept)).toBe(icon)
    expect(tabIcon(page("a", "", "https://a.example/login", true), undefined, kept)).toBe(icon)
    expect(tabIcon(page("a"), "data:image/png;base64,BB", kept)).toBe("data:image/png;base64,BB")
    // Another site's page has its own icon, or none.
    expect(tabIcon(page("a", "", "https://other.example/", true), undefined, kept)).toBeUndefined()
    expect(savedTab(saveTabs(saved, "s", [page("a", "A", "https://a.example/next")]) ?? empty, "s", "a")?.icon).toBe(icon)
    expect(savedTab(saveTabs(saved, "s", [page("a", "O", "https://other.example/")]) ?? empty, "s", "a")?.icon).toBeUndefined()
    // The same icon, an icon too large to keep, and a tab that is not saved write nothing.
    expect(saveIcon(saved, "s", "a", icon)).toBeUndefined()
    expect(saveIcon(saved, "s", "a", `data:image/png;base64,${"A".repeat(6_000)}`)).toBeUndefined()
    expect(saveIcon(saved, "s", "b", icon)).toBeUndefined()
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

  // The stored shape is the contract with every earlier launch: a record written without a title or an icon must load.
  test("a stored tab without a title or an icon loads", () => {
    const stored = Schema.decodeUnknownSync(SavedTabs)({
      sessions: [{ session: "s", tabs: [{ id: "a", url: "https://a.example/" }] }],
    })

    expect(savedTab(stored, "s", "a")).toEqual({ id: "a", url: "https://a.example/" })
  })
})
