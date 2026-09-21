import { describe, expect, test } from "bun:test"
import type { RunEvent, RunSnapshot } from "@bearmanser/opencode-superpowers-execution/contract"
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
  activityRun,
  agentFixture,
  detailedTasksRun,
  failedTaskFixture,
  gateOrderRun,
  halfVerifiedRun,
  increasedScopeRun,
  runFixture,
  smallScopeRun,
  taskFixture,
} from "./fixtures"
import { requestEvidenceReveal, revealPendingEvidence } from "./evidence-reveal"
import {
  AGENT_ROWS_VIRTUALIZE_THRESHOLD,
  EXECUTION_SUBVIEWS,
  createExecutionModel,
  evidenceAvailability,
  joinTaskAssignments,
  joinTaskEvidence,
  latestEvidenceForGate,
  structuredViewsEnabled,
  type ExecutionPreference,
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

  test("maps a resolving evidence reference to a neutral availability", () => {
    expect(evidenceAvailability(undefined)).toBe("unknown")
    expect(evidenceAvailability("resolving")).toBe("unknown")
    expect(evidenceAvailability("available")).toBe("true")
    expect(evidenceAvailability("unavailable")).toBe("false")
  })

  test("hands a resolved cross-session target to the destination session", async () => {
    await rootAsync(async () => {
      const model = createExecutionModel({
        snapshot: () => halfVerifiedRun(),
        agents: () => agentFixture("agents"),
        resolveEvidence: () => true,
        navigateEvidence: requestEvidenceReveal,
      })
      const revealed: string[] = []
      model.openEvidence({ id: "e-api-tests", sessionID: "child", messageID: "msg-api-1", partID: "part-api-1" })
      await settle()
      expect(model.evidenceResolution("e-api-tests")).toBe("available")
      expect(revealPendingEvidence({ sessionID: "child", ready: true, reveal: (messageID, partID) => revealed.push(`${messageID}#${partID ?? ""}`) })?.messageID).toBe(
        "msg-api-1",
      )
      expect(revealed).toEqual(["msg-api-1#part-api-1"])
    })
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

describe("createExecutionModel activity", () => {
  test("pages retained report events newest first and exposes the truncation boundary", () =>
    root(() => {
      const model = createExecutionModel({ snapshot: () => activityRun() })
      const page = model.activity()
      expect(page.total).toBe(150)
      expect(page.visible).toBe(100)
      expect(page.events).toHaveLength(100)
      expect(page.events[0]?.revision).toBe(1150)
      expect(page.events[99]?.revision).toBe(1051)
      expect(page.truncatedBeforeRevision).toBe(1001)
      expect(page.hasMore).toBe(true)
      model.loadMoreActivity()
      expect(model.activity().events).toHaveLength(150)
      expect(model.activity().hasMore).toBe(false)
      expect(model.activity().events.at(-1)?.revision).toBe(1001)
    }))

  test("never presents a partial retained window as complete history", () =>
    root(() => {
      const events: RunEvent[] = Array.from({ length: 1000 }, (_, index) => ({
        revision: index + 1,
        type: "task.state",
        taskID: "task-1",
        summary: `Event ${index + 1}`,
        createdAt: index,
      }))
      const model = createExecutionModel({
        snapshot: () =>
          runFixture({ revision: 1000, tasks: [taskFixture()], events, historyTruncatedBeforeRevision: 1 }),
      })
      expect(model.activity().total).toBe(1000)
      expect(model.activity().visible).toBe(100)
      expect(model.activity().truncatedBeforeRevision).toBe(1)
      expect(model.activity().hasMore).toBe(true)
    }))

  test("resolves a report event to its task and referenced session", () =>
    root(() => {
      const model = createExecutionModel({
        snapshot: () => activityRun(),
        agents: () => agentFixture("activity"),
      })
      const newest = model.activity().events[0]!
      expect(newest.taskID).toBe("task-api")
      expect(newest.taskTitle).toBe("API contract")
      expect(newest.sessionID).toBe("child")
      expect(newest.sessionTitle).toBe("Child implementer")
    }))

  test("sums only non-overlapping native usage and reports unavailable without records", () =>
    root(() => {
      const withAgents = createExecutionModel({
        snapshot: () => activityRun(),
        agents: () => agentFixture("activity"),
      })
      expect(withAgents.activityUsage().cost).toEqual({ value: 2.5, coverage: "complete" })
      expect(withAgents.activityUsage().tokens).toEqual({ value: 2425, coverage: "complete" })
      const withoutAgents = createExecutionModel({ snapshot: () => activityRun() })
      expect(withoutAgents.activityUsage().cost).toEqual({ value: undefined, coverage: "unavailable" })
      expect(withoutAgents.activityUsage().tokens).toEqual({ value: undefined, coverage: "unavailable" })
    }))

  test("absent native accounting is partial when other sessions report usage", () =>
    root(() => {
      const model = createExecutionModel({
        snapshot: () => activityRun(),
        agents: () => agentFixture("agents-telemetry"),
      })
      expect(model.agentTree().complete).toBe(true)
      expect(model.activityUsage().cost).toEqual({ value: 2, coverage: "partial" })
      expect(model.activityUsage().tokens).toEqual({ value: 2350, coverage: "partial" })
    }))

  test("reports partial usage coverage when the native tree is incomplete", () =>
    root(() => {
      const model = createExecutionModel({
        snapshot: () => activityRun(),
        agents: () => agentFixture("agents-telemetry-partial"),
      })
      expect(model.agentTree().complete).toBe(false)
      expect(model.activityUsage().cost).toEqual({ value: 2, coverage: "partial" })
      expect(model.activityUsage().tokens).toEqual({ value: 2350, coverage: "partial" })
    }))

  test("uses the adapter's authoritative completeness over the recomputed tree", () =>
    root(() => {
      const model = createExecutionModel({
        snapshot: () => activityRun(),
        agents: () => agentFixture("activity"),
        nativeComplete: () => false,
      })
      expect(model.agentTree().complete).toBe(true)
      expect(model.activityUsage().cost).toEqual({ value: 2.5, coverage: "partial" })
      expect(model.activityUsage().tokens).toEqual({ value: 2425, coverage: "partial" })
    }))

  test("links an assignment event to the assignment that event created, not a later worker", () =>
    root(() => {
      const history = runFixture({
        runID: "run-history",
        revision: 4,
        tasks: [taskFixture({ id: "task-1", title: "History task" })],
        events: [
          { revision: 1, type: "run.start", summary: "start", createdAt: 100 },
          { revision: 2, type: "assignment.add", taskID: "task-1", summary: "first", createdAt: 200 },
          { revision: 3, type: "assignment.add", taskID: "task-1", summary: "second", createdAt: 300 },
          { revision: 4, type: "task.state", taskID: "task-1", summary: "running", createdAt: 400 },
        ],
        assignments: [
          { id: "a1", taskID: "task-1", attempt: 1, sessionID: "child", role: "implementer", createdAt: 200 },
          { id: "a2", taskID: "task-1", attempt: 1, sessionID: "idle-child", role: "implementer", createdAt: 300 },
        ],
      })
      const model = createExecutionModel({ snapshot: () => history, agents: () => agentFixture("agents") })
      const events = model.activity().events
      expect(events.find((item) => item.revision === 2)?.sessionID).toBe("child")
      expect(events.find((item) => item.revision === 3)?.sessionID).toBe("idle-child")
      expect(events.find((item) => item.revision === 4)?.sessionID).toBe("root")
      expect(events.find((item) => item.revision === 1)?.sessionID).toBe("root")
    }))

  test("links an evidence event to its own record and the reporter for a verification", () =>
    root(() => {
      const history = runFixture({
        runID: "run-evidence",
        revision: 4,
        tasks: [taskFixture({ id: "task-1", title: "Evidence task" })],
        events: [
          { revision: 1, type: "run.start", summary: "start", createdAt: 100 },
          { revision: 2, type: "evidence.add", taskID: "task-1", summary: "old evidence", createdAt: 200 },
          { revision: 3, type: "evidence.add", taskID: "task-1", summary: "new evidence", createdAt: 300 },
          { revision: 4, type: "task.verify", taskID: "task-1", summary: "verified", createdAt: 400 },
        ],
        evidence: [
          {
            id: "e1",
            taskID: "task-1",
            attempt: 1,
            gate: "tests",
            outcome: "passed",
            summary: "old",
            sessionID: "child",
            messageID: "m1",
            reportedBySessionID: "root",
            createdAt: 200,
          },
          {
            id: "e2",
            taskID: "task-1",
            attempt: 1,
            gate: "tests",
            outcome: "passed",
            summary: "new",
            sessionID: "idle-child",
            messageID: "m2",
            reportedBySessionID: "root",
            createdAt: 300,
          },
        ],
      })
      const model = createExecutionModel({ snapshot: () => history, agents: () => agentFixture("agents") })
      const events = model.activity().events
      expect(events.find((item) => item.revision === 2)?.sessionID).toBe("child")
      expect(events.find((item) => item.revision === 3)?.sessionID).toBe("idle-child")
      expect(events.find((item) => item.revision === 4)?.sessionID).toBe("root")
    }))

  test("omits a session link when no durable record matches the event", () =>
    root(() => {
      const history = runFixture({
        runID: "run-orphan",
        revision: 2,
        tasks: [taskFixture({ id: "task-1" })],
        events: [
          { revision: 1, type: "run.start", summary: "start", createdAt: 100 },
          { revision: 2, type: "assignment.add", taskID: "task-1", summary: "orphan", createdAt: 999 },
        ],
        assignments: [
          { id: "a1", taskID: "task-1", attempt: 1, sessionID: "child", role: "implementer", createdAt: 200 },
        ],
      })
      const model = createExecutionModel({ snapshot: () => history, agents: () => agentFixture("agents") })
      expect(model.activity().events.find((item) => item.revision === 2)?.sessionID).toBeUndefined()
    }))

  test("merges injected message accounting without double counting a session summary", () =>
    root(() => {
      const scope = (): ExecutionScope => ({ serverKey: "wsl", ownerDirectory: "/root/git/demo", rootSessionID: "root" })
      const model = createExecutionModel({
        scope,
        snapshot: () => activityRun(),
        agents: () => agentFixture("activity"),
        usage: () => [
          {
            serverKey: "wsl",
            sessionID: "root",
            messageID: "msg-a",
            cost: 99,
            tokens: { input: 9900, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
          },
          {
            serverKey: "wsl",
            sessionID: "root",
            messageID: "msg-a",
            cost: 99,
            tokens: { input: 9900, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
          },
        ],
      })
      expect(model.activityUsage().cost).toEqual({ value: 2.5, coverage: "complete" })
      expect(model.activityUsage().duplicates).toBe(1)
      expect(model.activityUsage().rejected.inclusive).toBe(1)
    }))

  test("resets activity pagination when the run changes", () =>
    root(() => {
      const [snapshot, setSnapshot] = createSignal<RunSnapshot | undefined>(activityRun())
      const model = createExecutionModel({ snapshot })
      model.loadMoreActivity()
      expect(model.activity().visible).toBe(150)
      setSnapshot(runFixture({ runID: "run-other", revision: 1, events: [] }))
      expect(model.activity().visible).toBe(0)
      expect(model.activity().total).toBe(0)
      expect(model.activity().hasMore).toBe(false)
    }))
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

describe("execution presentation preferences", () => {
  const rootScope = (rootSessionID: string): ExecutionScope => ({
    serverKey: "wsl",
    ownerDirectory: "/root/git/demo",
    rootSessionID,
  })

  test("resets transient expansion and restores each root's remembered subview and task", () =>
    root(() => {
      const [scope, setScope] = createSignal<ExecutionScope>(rootScope("root"))
      const model = createExecutionModel({ scope, snapshot: () => runFixture() })
      model.selectSubview("tasks")
      model.selectTask("api")
      model.setExpanded(true)
      expect(model.expanded()).toBe(true)
      setScope(rootScope("other-root"))
      expect(model.expanded()).toBe(false)
      expect(model.subview()).toBe("map")
      expect(model.selectedTaskID()).toBeUndefined()
      setScope(rootScope("root"))
      expect(model.subview()).toBe("tasks")
      expect(model.selectedTaskID()).toBe("api")
      expect(model.expanded()).toBe(false)
    }))

  test("defaults to the map on a wide presentation and to the task list when a narrow run arrives", () =>
    root(() => {
      const [snapshot, setSnapshot] = createSignal<RunSnapshot | undefined>()
      const [narrow, setNarrow] = createSignal(true)
      const model = createExecutionModel({ snapshot, narrow })
      expect(model.subview()).toBe("agents")
      setSnapshot(runFixture())
      expect(model.subview()).toBe("tasks")
      model.selectSubview("map")
      expect(model.subview()).toBe("map")
      setSnapshot(runFixture({ revision: 9 }))
      expect(model.subview()).toBe("map")
      setNarrow(false)
      expect(model.subview()).toBe("map")
      expect(createExecutionModel({ snapshot: () => runFixture() }).subview()).toBe("map")
      expect(createExecutionModel({ snapshot: () => runFixture(), narrow: () => true }).subview()).toBe("tasks")
    }))

  test("scopes preferences to server, owner directory, root, and run", () =>
    root(() => {
      const [scope, setScope] = createSignal<ExecutionScope>(rootScope("root"))
      const [snapshot, setSnapshot] = createSignal<RunSnapshot | undefined>(runFixture({ runID: "run-a" }))
      const model = createExecutionModel({ scope, snapshot })
      model.selectSubview("tasks")
      model.selectTask("api")
      setSnapshot(runFixture({ runID: "run-b" }))
      expect(model.subview()).toBe("map")
      expect(model.selectedTaskID()).toBeUndefined()
      setSnapshot(runFixture({ runID: "run-a" }))
      expect(model.subview()).toBe("tasks")
      expect(model.selectedTaskID()).toBe("api")
      setScope({ serverKey: "wsl", ownerDirectory: "/root/git/other", rootSessionID: "root" })
      expect(model.subview()).toBe("map")
      expect(model.selectedTaskID()).toBeUndefined()
    }))

  test("round-trips preferences through the injected store, including the observer key", () =>
    root(() => {
      const entries = new Map<string, ExecutionPreference>()
      const preferences = {
        get: (key: string) => entries.get(key),
        set: (key: string, value: ExecutionPreference) => entries.set(key, value),
      }
      const scope = () => ({ serverKey: "wsl", ownerDirectory: "/root/git/demo", rootSessionID: "root" })
      const first = createExecutionModel({ scope, snapshot: () => runFixture(), preferences })
      first.selectSubview("activity")
      first.selectTask("api")
      expect(entries.size).toBe(1)
      const [key] = [...entries.keys()]
      expect(key?.split("\u0000")).toEqual(["wsl", "/root/git/demo", "root", "run-1"])
      const restored = createExecutionModel({ scope, snapshot: () => runFixture(), preferences })
      expect(restored.subview()).toBe("activity")
      expect(restored.selectedTaskID()).toBe("api")
      const observer = createExecutionModel({ scope, preferences })
      observer.selectSubview("agents")
      const observerKey = [...entries.keys()].at(-1)
      expect(observerKey?.split("\u0000")).toEqual(["wsl", "/root/git/demo", "root", ""])
      expect(createExecutionModel({ scope, preferences }).subview()).toBe("agents")
    }))
})
