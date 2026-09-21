import { describe, expect, test } from "bun:test"
import type { RunSnapshot } from "@bearmanser/opencode-superpowers-execution/contract"
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
import { summarizeProgress } from "@bearmanser/opencode-superpowers-execution/contract"
import {
  agentFixture,
  detailedTasksRun,
  failedTaskFixture,
  gateOrderRun,
  halfVerifiedRun,
  increasedScopeRun,
  runFixture,
  smallScopeRun,
} from "./fixtures"
import {
  AGENT_ROWS_VIRTUALIZE_THRESHOLD,
  EXECUTION_SUBVIEWS,
  createExecutionModel,
  joinTaskAssignments,
  joinTaskEvidence,
  latestEvidenceForGate,
  structuredViewsEnabled,
  type ExecutionMode,
} from "./model"
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

function rootAsync(assert: () => Promise<void>) {
  return new Promise<void>((resolve, reject) => {
    createRoot((dispose) => {
      assert().then(
        () => {
          dispose()
          resolve()
        },
        (error) => {
          dispose()
          reject(error)
        },
      )
    })
  })
}

const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

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

  test("enters failure attention when a bridge snapshot reports a failed task", () => {
    root(() => {
      const [snapshot, setSnapshot] = createSignal<RunSnapshot | undefined>(
        runFixture({ tasks: [failedTaskFixture()] }),
      )
      const model = createExecutionModel({ snapshot })
      expect(model.run()?.revision).toBe(1)
      expect(model.progress()?.failed).toBe(1)
      expect(model.attention().failed).toBe(1)
      setSnapshot(undefined)
      expect(model.attention().failed).toBe(0)
      expect(model.progress()).toBeUndefined()
    })
  })

  test("merges structured blocked tasks with native blocking", () => {
    root(() => {
      const blocked = runFixture({ tasks: [failedTaskFixture({ id: "task-blocked", state: "blocked" })] })
      const numeric = createExecutionModel({ snapshot: () => blocked })
      expect(numeric.attention().blocked).toBe(1)
      const merged = createExecutionModel({
        snapshot: () => blocked,
        attention: () => ({ stale: false, needsInput: 0, failed: 0, blocked: 3 }),
      })
      expect(merged.attention().blocked).toBe(3)
    })
  })

  test("defaults to the map when a structured snapshot is available and keeps a persisted choice", () => {
    root(() => {
      const initial = createExecutionModel({ snapshot: () => runFixture() })
      expect(initial.subview()).toBe("map")
      const persisted = createExecutionModel({ initialSubview: "tasks", snapshot: () => runFixture() })
      expect(persisted.subview()).toBe("tasks")
      const observer = createExecutionModel()
      expect(observer.subview()).toBe("agents")
    })
  })

  test("suppresses structured projections while the schema is incompatible", () => {
    root(() => {
      const [mode, setMode] = createSignal<ExecutionMode>("ready")
      const model = createExecutionModel({
        mode,
        snapshot: () => runFixture({ tasks: [failedTaskFixture()] }),
        attention: () => ({ stale: false, needsInput: 0, failed: 0, blocked: 0 }),
      })
      expect(model.mode()).toBe("ready")
      expect(model.structured()).toBe(true)
      expect(model.run()).toBeDefined()
      expect(model.progress()?.failed).toBe(1)
      expect(model.attention().failed).toBe(1)
      setMode("incompatible")
      expect(model.mode()).toBe("incompatible")
      expect(model.structured()).toBe(false)
      expect(model.run()).toBeUndefined()
      expect(model.progress()).toBeUndefined()
      expect(model.attention().failed).toBe(0)
      expect(structuredViewsEnabled("incompatible")).toBe(false)
    })
  })
})

describe("createExecutionModel tasks", () => {
  test("joins assignments by task and attempt without collapsing a reused session", () => {
    const run = detailedTasksRun()
    const agents = agentFixture("agents")
    const join = joinTaskAssignments({ run, taskID: "task-verified", attempt: 1, agents })
    expect(join.current.map((row) => row.id)).toEqual(["a-inline", "a-impl", "a-review", "a-idle"])
    expect(join.history).toEqual([])
    expect(join.uniqueSessions).toBe(3)
    expect(join.current.find((row) => row.id === "a-review")?.sessionID).toBe("child")
    expect(join.current.find((row) => row.id === "a-inline")?.role).toBe("controller")
    expect(join.current.find((row) => row.id === "a-idle")?.active).toBe(false)
    const failed = joinTaskAssignments({ run, taskID: "task-failed", attempt: 2, agents })
    expect(failed.current).toEqual([])
    expect(failed.history.map((row) => row.id)).toEqual(["a-old"])
  })

  test("joins current-attempt evidence separately from superseded attempts", () => {
    const run = detailedTasksRun()
    const agents = agentFixture("agents")
    const evidence = joinTaskEvidence({ run, taskID: "task-failed", attempt: 2, agents })
    expect(evidence.current.map((row) => row.id)).toEqual(["e-failed-new"])
    expect(evidence.superseded.map((row) => row.id)).toEqual(["e-failed-old"])
    expect(evidence.current[0]?.outcome).toBe("failed")
  })

  test("does not infer evidence availability from the agent list", () => {
    const run = detailedTasksRun()
    const agents = agentFixture("agents")
    const ghost = joinTaskEvidence({ run, taskID: "task-review", attempt: 1, agents }).current[0]
    expect(ghost && "available" in ghost).toBe(false)
    expect(ghost?.summary).toBe("Spec review reported from a deleted session")
    expect(ghost?.outcome).toBe("passed")
    expect(ghost?.sessionID).toBe("ghost")
  })

  test("keeps the latest gate report in ledger order when ids and timestamps tie", () => {
    const run = gateOrderRun()
    const agents = agentFixture("agents")
    const join = joinTaskEvidence({ run, taskID: "task-gate", attempt: 1, agents })
    expect(join.current.map((row) => row.id)).toEqual(["z-pass", "a-fail"])
    expect(latestEvidenceForGate(join.current, "tests")?.id).toBe("a-fail")
    expect(latestEvidenceForGate(join.current, "tests")?.outcome).toBe("failed")
  })

  test("resolves evidence lazily and navigates the specific resolved target", async () => {
    await rootAsync(async () => {
      const navigated: string[] = []
      const model = createExecutionModel({
        snapshot: () => halfVerifiedRun(),
        agents: () => agentFixture("agents"),
        resolveEvidence: ({ messageID }) => messageID === "msg-api-1",
        navigateEvidence: (reference) =>
          navigated.push(`${reference.sessionID}#${reference.messageID}#${reference.partID ?? ""}`),
      })
      const missing = { id: "e-api-review", sessionID: "idle-child", messageID: "msg-api-2" }
      expect(model.evidenceResolution(missing.id)).toBeUndefined()
      model.openEvidence(missing)
      expect(model.evidenceResolution(missing.id)).toBe("resolving")
      await settle()
      expect(model.evidenceResolution(missing.id)).toBe("unavailable")
      expect(navigated).toEqual([])
      const resolved = { id: "e-api-tests", sessionID: "child", messageID: "msg-api-1", partID: "part-api-1" }
      model.openEvidence(resolved)
      await settle()
      expect(model.evidenceResolution(resolved.id)).toBe("available")
      expect(navigated).toEqual(["child#msg-api-1#part-api-1"])
    })
  })

  test("exposes the selected task and joins through the model", () => {
    root(() => {
      const model = createExecutionModel({ snapshot: () => detailedTasksRun(), agents: () => agentFixture("agents") })
      model.selectTask("task-verified")
      expect(model.selectedTask()?.title).toBe("Verified work")
      expect(model.taskAssignments("task-verified", 1).uniqueSessions).toBe(3)
      expect(model.taskEvidence("task-verified", 1).current).toHaveLength(2)
    })
  })

  test("summarizes every task state without an arbitrary percent field", () => {
    const run = detailedTasksRun()
    expect(new Set(run.tasks.map((task) => task.state))).toEqual(
      new Set(["pending", "running", "blocked", "awaiting_review", "verified", "failed", "skipped"]),
    )
    expect(summarizeProgress(run.tasks)).toEqual({
      verified: 1,
      total: 7,
      skipped: 1,
      failed: 1,
      blocked: 1,
      awaitingReview: 1,
      percent: 14,
      source: "controller_report",
    })
  })

  test("reduces the fraction when a new plan revision increases scope", () => {
    expect(summarizeProgress(smallScopeRun().tasks).percent).toBe(100)
    expect(summarizeProgress(increasedScopeRun().tasks).percent).toBe(50)
    expect(smallScopeRun().plan.revision).toBe(1)
    expect(increasedScopeRun().plan.revision).toBe(2)
  })

  test("keeps a cancelled run's historical fraction while reporting cancellation", () => {
    const cancelled = { ...halfVerifiedRun(), status: "cancelled" as const }
    expect(cancelled.status).toBe("cancelled")
    expect(summarizeProgress(cancelled.tasks)).toEqual({
      verified: 1,
      total: 2,
      skipped: 0,
      failed: 0,
      blocked: 0,
      awaitingReview: 1,
      percent: 50,
      source: "controller_report",
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

  test("forwards the native request focus action", () =>
    root(() => {
      const recentered: number[] = []
      const model = createExecutionModel({ reviewRequest: () => recentered.push(recentered.length) })
      model.reviewRequest()
      expect(recentered).toHaveLength(1)
    }))

  test("virtualizes agent rows above one hundred", () => {
    expect(AGENT_ROWS_VIRTUALIZE_THRESHOLD).toBe(100)
  })
})
