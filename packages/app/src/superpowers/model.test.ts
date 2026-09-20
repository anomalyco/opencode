import { describe, expect, test } from "bun:test"
import { createRoot } from "solid-js"
import { createStore } from "solid-js/store"
import { createSessionTabs, getTabReorderIndex } from "../session/helpers"
import {
  SESSION_EXECUTION_TAB,
  closeSessionTab,
  openSessionTab,
  previewSessionTab,
  sessionBrowserTab,
  type SessionTabState,
} from "../shell/state/session-tabs"
import { EXECUTION_SUBVIEWS, createExecutionModel } from "./model"

type TabsInput = {
  active?: string
  all: string[]
  execution?: boolean
  fileBrowser?: boolean
  browser?: boolean
  review?: boolean
  hasReview?: boolean
}

function tabsOf(input: TabsInput) {
  const [state] = createStore({ active: input.active, all: input.all })
  return createSessionTabs({
    tabs: () => ({ active: () => state.active, all: () => state.all }),
    pathFromTab: (tab) => (tab.startsWith("file://") ? tab.slice("file://".length) : undefined),
    normalizeTab: (tab) => tab,
    execution: () => input.execution ?? false,
    fileBrowser: () => input.fileBrowser ?? false,
    browser: () => input.browser ?? false,
    review: () => input.review ?? false,
    hasReview: () => input.hasReview ?? false,
  })
}

function root(assert: () => void) {
  createRoot((dispose) => {
    assert()
    dispose()
  })
}

function state(all: string[], active?: string, preview?: string): SessionTabState {
  return { tabs: { all, active }, preview }
}

test("execution is selectable but never a file tab", () =>
  root(() => {
    const result = tabsOf({ active: SESSION_EXECUTION_TAB, all: [SESSION_EXECUTION_TAB, "file://a.ts"], execution: true })
    expect(result.activeTab()).toBe(SESSION_EXECUTION_TAB)
    expect(result.activeFileTab()).toBeUndefined()
    expect(result.openedTabs()).not.toContain(SESSION_EXECUTION_TAB)
    expect(result.closableTab()).toBe(SESSION_EXECUTION_TAB)
    expect(result.panelTabs()).toContain(SESSION_EXECUTION_TAB)
  }))

test("execution follows the same open, close, and reopen lifecycle as a persistent tab", () => {
  const base = state(["file://a.ts"], "file://a.ts")
  const opened = openSessionTab(base, SESSION_EXECUTION_TAB)
  expect(opened.tabs.all).toEqual(["file://a.ts", SESSION_EXECUTION_TAB])
  expect(opened.tabs.active).toBe(SESSION_EXECUTION_TAB)

  root(() => {
    expect(tabsOf({ active: opened.tabs.active, all: opened.tabs.all, execution: true }).activeTab()).toBe(
      SESSION_EXECUTION_TAB,
    )
  })

  const closed = closeSessionTab(opened, SESSION_EXECUTION_TAB)
  expect(closed.tabs.all).toEqual(["file://a.ts"])
  expect(closed.tabs.active).toBe("file://a.ts")
  root(() => {
    expect(tabsOf({ active: closed.tabs.active, all: closed.tabs.all, execution: true }).activeTab()).toBe("file://a.ts")
  })

  const reopened = openSessionTab(closed, SESSION_EXECUTION_TAB)
  expect(reopened.tabs.all).toEqual(["file://a.ts", SESSION_EXECUTION_TAB])
  expect(reopened.tabs.active).toBe(SESSION_EXECUTION_TAB)
  root(() => {
    expect(tabsOf({ active: reopened.tabs.active, all: reopened.tabs.all, execution: true }).activeTab()).toBe(
      SESSION_EXECUTION_TAB,
    )
  })
})

test("previewing a file replaces only the preview and keeps execution open", () => {
  const next = previewSessionTab(state(["file://a.ts", SESSION_EXECUTION_TAB], "file://a.ts", "file://a.ts"), "file://b.ts")
  expect(next.tabs.all).toEqual(["file://b.ts", SESSION_EXECUTION_TAB])
  expect(next.preview).toBe("file://b.ts")
  root(() => {
    const result = tabsOf({ active: next.tabs.active, all: next.tabs.all, execution: true })
    expect(result.panelTabs()).toEqual(["file://b.ts", SESSION_EXECUTION_TAB])
    expect(result.openedTabs()).toEqual(["file://b.ts"])
  })
})

test("drag order keeps execution beside its neighbours", () => {
  const all = ["file://a.ts", SESSION_EXECUTION_TAB, "file://b.ts"]
  const to = getTabReorderIndex(all, SESSION_EXECUTION_TAB, "file://b.ts")
  expect(to).toBe(2)
  const moved = [...all]
  moved.splice(to!, 0, moved.splice(moved.indexOf(SESSION_EXECUTION_TAB), 1)[0]!)
  expect(moved).toEqual(["file://a.ts", "file://b.ts", SESSION_EXECUTION_TAB])
  root(() => {
    expect(tabsOf({ active: SESSION_EXECUTION_TAB, all: moved, execution: true }).panelTabs()).toEqual(moved)
  })
})

test("a persisted execution tab falls back when the feature is unavailable", () => {
  root(() => {
    const result = tabsOf({
      active: SESSION_EXECUTION_TAB,
      all: [SESSION_EXECUTION_TAB, "file://a.ts"],
      execution: false,
    })
    expect(result.panelTabs()).toEqual(["file://a.ts"])
    expect(result.activeTab()).toBe("file://a.ts")
    expect(result.activeFileTab()).toBe("file://a.ts")
  })
})

test("a persisted execution active tab that is no longer open falls back", () => {
  root(() => {
    const result = tabsOf({ active: SESSION_EXECUTION_TAB, all: ["file://a.ts"], execution: false })
    expect(result.executionOpen()).toBe(false)
    expect(result.activeTab()).toBe("file://a.ts")
    expect(result.closableTab()).toBe("file://a.ts")
  })
})

test("execution stays selectable without Review or Git availability", () => {
  root(() => {
    const result = tabsOf({
      active: SESSION_EXECUTION_TAB,
      all: [SESSION_EXECUTION_TAB],
      execution: true,
      review: false,
      hasReview: false,
      fileBrowser: false,
    })
    expect(result.activeTab()).toBe(SESSION_EXECUTION_TAB)
    expect(result.closableTab()).toBe(SESSION_EXECUTION_TAB)
    expect(result.activeFileTab()).toBeUndefined()
  })
})

test("browser, execution, and review each win selection when active", () => {
  const browserTab = sessionBrowserTab("one")
  const all = [browserTab, SESSION_EXECUTION_TAB]
  root(() => {
    expect(tabsOf({ active: browserTab, all, execution: true, browser: true, review: true }).activeTab()).toBe(browserTab)
    expect(tabsOf({ active: SESSION_EXECUTION_TAB, all, execution: true, browser: true, review: true }).activeTab()).toBe(
      SESSION_EXECUTION_TAB,
    )
    expect(tabsOf({ active: "review", all, execution: true, browser: true, review: true }).activeTab()).toBe("review")
  })
})

describe("createExecutionModel", () => {
  test("defaults to observer mode on the agents subview with no fabricated progress", () => {
    root(() => {
      const model = createExecutionModel()
      expect(model.mode()).toBe("observer")
      expect(model.subview()).toBe("agents")
      expect(EXECUTION_SUBVIEWS).toEqual(["map", "agents", "tasks", "activity"])
      expect(model.progress()).toBeUndefined()
      expect(model.run()).toBeUndefined()
      expect(model.expanded()).toBe(false)
      expect(model.attention()).toEqual({ stale: false, needsInput: 0, failed: 0, blocked: 0 })
      expect(model.agents()).toEqual([])
    })
  })

  test("selects subviews, tasks, runs, and expansion without ledger mutation", () => {
    root(() => {
      const model = createExecutionModel()
      model.selectSubview("map")
      expect(model.subview()).toBe("map")
      model.selectTask("api")
      expect(model.selectedTaskID()).toBe("api")
      model.setExpanded(true)
      expect(model.expanded()).toBe(true)
      model.selectRun("run-1")
      model.reconcile()
      expect(model.subview()).toBe("map")
    })
  })

  test("opens sessions through the injected native boundary", () => {
    root(() => {
      const opened: string[] = []
      let reconciled = 0
      const model = createExecutionModel({
        openSession: (sessionID) => opened.push(sessionID),
        reconcile: () => {
          reconciled += 1
        },
      })
      model.openSession("child")
      model.reconcile()
      expect(opened).toEqual(["child"])
      expect(reconciled).toBe(1)
    })
  })
})
