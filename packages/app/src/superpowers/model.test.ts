import { describe, expect, test } from "bun:test"
import { createRoot, createSignal } from "solid-js"
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
import { agentFixture } from "./fixtures"
import { AGENT_ROWS_VIRTUALIZE_THRESHOLD, EXECUTION_SUBVIEWS, createExecutionModel } from "./model"
import type { ExecutionScope } from "./identity"

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

describe("createExecutionModel agents", () => {
  const scope = (): ExecutionScope => ({ serverKey: "wsl", ownerDirectory: "/root/git/demo", rootSessionID: "root" })

  test("projects the controller and descendants and keeps idle distinct from completion", () =>
    root(() => {
      const model = createExecutionModel({ scope, agents: () => agentFixture("agents") })
      const tree = model.agentTree()
      expect(tree.rootSessionID).toBe("root")
      expect(tree.complete).toBe(true)
      expect(tree.nodes.map((node) => node.id)).toEqual(["root", "child", "idle-child", "grandchild"])

      const rows = model.agentRows()
      expect(rows.map((row) => row.agent.id)).toEqual(["root", "child", "idle-child"])
      expect(rows[0]!.controller).toBe(true)
      expect(rows[0]!.expanded).toBe(true)
      expect(rows.find((row) => row.agent.id === "child")!.hasChildren).toBe(true)
      expect(rows.find((row) => row.agent.id === "child")!.expanded).toBe(false)
      expect(rows.find((row) => row.agent.id === "idle-child")!.agent.state).toBe("idle")
    }))

  test("preserves expanded state by server, root, and session ID", () =>
    root(() => {
      const [scopeSignal, setScope] = createSignal(scope())
      const model = createExecutionModel({ scope: scopeSignal, agents: () => agentFixture("agents") })
      expect(model.isAgentExpanded("child")).toBe(false)
      model.toggleAgentExpanded("child")
      expect(model.isAgentExpanded("child")).toBe(true)
      expect(model.agentRows().some((row) => row.agent.id === "grandchild")).toBe(true)
      setScope({ serverKey: "wsl", ownerDirectory: "/root/git/other", rootSessionID: "root" })
      expect(model.isAgentExpanded("child")).toBe(true)
      expect(model.agentRows().some((row) => row.agent.id === "grandchild")).toBe(true)
      setScope({ serverKey: "wsl", ownerDirectory: "/root/git/demo", rootSessionID: "other-root" })
      expect(model.isAgentExpanded("child")).toBe(false)
      expect(model.agentRows().some((row) => row.agent.id === "grandchild")).toBe(false)
      setScope({ serverKey: "ssh:other", ownerDirectory: "/root/git/demo", rootSessionID: "root" })
      expect(model.isAgentExpanded("child")).toBe(false)
    }))

  test("keeps multiple assignments on one session instead of cloning the session", () =>
    root(() => {
      const [scopeSignal, setScope] = createSignal(scope())
      const model = createExecutionModel({ scope: scopeSignal, agents: () => agentFixture("agents-assignments") })
      const rows = model.agentRows()
      expect(rows.filter((row) => row.agent.id === "child")).toHaveLength(1)
      expect(rows.find((row) => row.agent.id === "child")!.agent.assignments).toHaveLength(3)
      expect(model.isAssignmentHistoryExpanded("child")).toBe(false)
      model.toggleAssignmentHistory("child")
      expect(model.isAssignmentHistoryExpanded("child")).toBe(true)
      setScope({ serverKey: "wsl", ownerDirectory: "/root/git/other", rootSessionID: "root" })
      expect(model.isAssignmentHistoryExpanded("child")).toBe(true)
      setScope({ serverKey: "wsl", ownerDirectory: "/root/git/demo", rootSessionID: "other-root" })
      expect(model.isAssignmentHistoryExpanded("child")).toBe(false)
    }))

  test("keeps a deleted child and marks the tree partial", () =>
    root(() => {
      const model = createExecutionModel({ scope, agents: () => agentFixture("agents-deleted") })
      expect(model.agentTree().complete).toBe(false)
      model.toggleAgentExpanded("child")
      const deleted = model.agentRows().find((row) => row.agent.id === "deleted-child")
      expect(deleted?.agent.state).toBe("error")
      expect(deleted?.agent.error).toBe("Session not found")
    }))

  test("retries a failed child through the injected boundary", () =>
    root(() => {
      const retried: string[] = []
      const model = createExecutionModel({ retry: (sessionID) => retried.push(sessionID) })
      model.retryAgent("deleted-child")
      expect(retried).toEqual(["deleted-child"])
    }))

  test("virtualizes agent rows above one hundred", () => {
    expect(AGENT_ROWS_VIRTUALIZE_THRESHOLD).toBe(100)
  })
})
