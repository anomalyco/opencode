import { describe, expect, test } from "bun:test"
import type { SessionPane } from "@/shell/state/session-tabs"
import {
  createNewTabsState,
  selectHasNewTabs,
  selectPaneNewTabs,
  selectShownNewTab,
  transitionNewTabs,
  type NewTabsEvent,
  type NewTabsState,
  type PaneTabSnapshot,
  type RegionTabSnapshot,
} from "./new-tab-machine"

type Region = {
  session?: string
  sideOpen?: boolean
  regionActive?: string
  side?: PaneTabSnapshot
  split?: PaneTabSnapshot
  bottom?: PaneTabSnapshot
}

const none: PaneTabSnapshot = { active: undefined, keys: [] }

function snapshot(region: Region): RegionTabSnapshot {
  const panes = { side: region.side ?? none, split: region.split ?? none, bottom: region.bottom ?? none }

  return {
    session: region.session ?? "s1",
    empty: Object.values(panes).every((pane) => pane.keys.length === 0),
    regionActive: region.regionActive,
    sideOpen: region.sideOpen ?? false,
    panes,
  }
}

const sync = (region: Region): NewTabsEvent => ({ type: "sync", snapshot: snapshot(region) })

function run(events: NewTabsEvent[], state: NewTabsState = createNewTabsState()) {
  return events.reduce(
    (current, event) => {
      const next = transitionNewTabs(current.state, event)

      return { state: next.state, emptied: current.emptied + next.effects.length }
    },
    { state, emptied: 0 },
  )
}

function shown(state: NewTabsState, region: Region, pane: SessionPane) {
  return selectShownNewTab(state, pane, snapshot(region).panes[pane].active)
}

describe("new tab machine", () => {
  test("closing a tab in another pane keeps the side pane's New tab", () => {
    // The side pane falls back to README while the split pane's terminal holds the region's selection.
    const before: Region = {
      regionActive: "term:1",
      side: { active: "file://README.md", keys: ["review:changes", "file://README.md"] },
      split: { active: "term:1", keys: ["term:1"] },
    }
    // Closing the terminal moves the region's selection to the first tab, which the side pane now shows.
    const after: Region = {
      regionActive: "review:changes",
      side: { active: "review:changes", keys: ["review:changes", "file://README.md"] },
    }
    const result = run([sync(before), { type: "open", pane: "side" }, sync(after)])

    expect(selectPaneNewTabs(result.state, "side")).toEqual(["new:1"])
    expect(shown(result.state, after, "side")).toBe("new:1")
  })

  test("a launcher that replaces the preview tab in place replaces the New tab", () => {
    const before: Region = { regionActive: "file://foo.ts", side: { active: "file://foo.ts", keys: ["file://foo.ts"] } }
    const after: Region = { regionActive: "file://bar.ts", side: { active: "file://bar.ts", keys: ["file://bar.ts"] } }
    const result = run([sync(before), { type: "open", pane: "side" }, sync(after)])

    expect(selectPaneNewTabs(result.state, "side")).toEqual([])
    expect(result.state.panes.side.chosen).toBeUndefined()
  })

  test("a launcher that selects an already listed tab replaces the New tab", () => {
    const before: Region = { regionActive: "a", side: { active: "a", keys: ["a", "b"] } }
    const after: Region = { regionActive: "b", side: { active: "b", keys: ["a", "b"] } }
    const result = run([sync(before), { type: "open", pane: "side" }, { type: "open", pane: "side" }, sync(after)])

    // Only the shown one goes; the other New tab stays, and nothing is chosen.
    expect(result.state.panes.side).toEqual({ ids: ["new:1"], chosen: undefined })
    expect(shown(result.state, after, "side")).toBeUndefined()
  })

  test("closing the pane's selected tab falls back and keeps the New tab", () => {
    const before: Region = { regionActive: "a", side: { active: "a", keys: ["a", "b"] } }
    const after: Region = { regionActive: "b", side: { active: "b", keys: ["b"] } }
    const result = run([sync(before), { type: "open", pane: "side" }, sync(after)])

    expect(shown(result.state, after, "side")).toBe("new:1")
  })

  test("selecting a strip tab shows it over the New tab, which stays", () => {
    const before: Region = { regionActive: "a", side: { active: "a", keys: ["a", "b"] } }
    const after: Region = { regionActive: "b", side: { active: "b", keys: ["a", "b"] } }
    const result = run([sync(before), { type: "open", pane: "side" }, { type: "select.tab", pane: "side" }, sync(after)])

    expect(result.state.panes.side).toEqual({ ids: ["new:1"], chosen: undefined })
  })

  test("a split pane that loses its last tab takes its New tabs and choice with it", () => {
    const open: Region = { regionActive: "t", side: none, split: { active: "t", keys: ["t"] } }
    const closed: Region = { side: { active: "a", keys: ["a"] } }
    const result = run([sync(open), { type: "open", pane: "split" }, sync(closed)])

    expect(result.state.panes.split).toEqual({ ids: [], chosen: undefined })
  })

  test("another session starts without the previous session's New tabs", () => {
    const region: Region = { side: { active: "a", keys: ["a"] }, regionActive: "a" }
    const result = run([sync(region), { type: "open", pane: "side" }, sync({ ...region, session: "s2" })])

    expect(result.state.panes.side).toEqual({ ids: [], chosen: undefined })
  })

  test("selecting a New tab that is not listed changes nothing", () => {
    const state = run([sync({ side: { active: "a", keys: ["a"] } })]).state
    const next = transitionNewTabs(state, { type: "select.new", pane: "side", id: "new:9" })

    expect(next.state).toBe(state)
  })

  test("opening an empty side region opens one New tab per opening", () => {
    const empty: Region = { sideOpen: true }
    const opened = run([sync({}), sync(empty)])

    expect(selectPaneNewTabs(opened.state, "side")).toEqual(["new:1"])

    // Closing it inside the same opening does not bring it back.
    const dismissed = run([{ type: "dismiss", id: "new:1", empty: true }, sync(empty)], opened.state)

    expect(dismissed.emptied).toBe(1)
    expect(selectHasNewTabs(dismissed.state)).toBe(false)

    // The next opening shows one again.
    const reopened = run([sync({}), sync(empty)], dismissed.state)

    expect(selectPaneNewTabs(reopened.state, "side")).toEqual(["new:2"])
  })

  test("an opening keeps a New tab left from an earlier one rather than adding another", () => {
    const result = run([sync({}), { type: "open", pane: "side" }, sync({ sideOpen: true })])

    expect(selectPaneNewTabs(result.state, "side")).toEqual(["new:1"])
  })

  test("routing into an open, empty side region opens a New tab for that session", () => {
    const result = run([sync({ sideOpen: true }), sync({ sideOpen: true, session: "s2" })])

    expect(selectPaneNewTabs(result.state, "side")).toEqual(["new:2"])
  })

  test("closing the shown New tab shows the one after it, else the one before", () => {
    const region: Region = { side: { active: "a", keys: ["a"] }, regionActive: "a" }
    const three = run([
      sync(region),
      { type: "open", pane: "side" },
      { type: "open", pane: "side" },
      { type: "open", pane: "side" },
      { type: "select.new", pane: "side", id: "new:2" },
    ])
    const middle = run([{ type: "dismiss", id: "new:2", empty: false }], three.state)

    expect(middle.state.panes.side).toEqual({ ids: ["new:1", "new:3"], chosen: "new:3" })

    const last = run([{ type: "dismiss", id: "new:3", empty: false }], middle.state)

    expect(last.state.panes.side).toEqual({ ids: ["new:1"], chosen: "new:1" })
    expect(last.emptied).toBe(0)
  })

  test("a sync that changes nothing returns the same state", () => {
    const region: Region = { side: { active: "a", keys: ["a"] }, regionActive: "a" }
    const state = run([sync(region)]).state

    expect(transitionNewTabs(state, sync(region)).state).toBe(state)
  })
})
