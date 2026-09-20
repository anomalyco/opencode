import { expect, test } from "bun:test"
import { pluginVersion } from "../src/plugin"
import { runKey } from "../src/repository"
import type { ReportCommand, RunSnapshot, RunSummary } from "../src/schema"
import { fixtureReport, fixtureStart, pluginHarness, type PluginHarness } from "./fixtures"

const owner = "/root/git/demo"
const root = { sessionID: "root" }

async function startRun(harness: PluginHarness, runID: string) {
  return harness.callTool("execution_report", fixtureStart({ operationID: `start-${runID}`, runID }), root)
}

async function cancelRun(harness: PluginHarness, runID: string) {
  const command: ReportCommand = {
    operationID: `cancel-${runID}`,
    runID,
    expectedRevision: 1,
    operation: { type: "run.cancel", reason: "seeded" },
  }
  return harness.callTool("execution_report", command, root)
}

test("a root controller reports and replays the same operation without a second write", async () => {
  const harness = await pluginHarness({ sessions: [{ id: "root" }] })
  const started = await harness.callTool<{ run: RunSnapshot; appliedRevision: number; duplicate: boolean }>(
    "execution_report",
    fixtureStart(),
    root,
  )
  expect(started.ok).toBe(true)
  if (!started.ok) return
  expect(started.value.duplicate).toBe(false)
  expect(started.value.appliedRevision).toBe(1)
  expect(started.value.run.revision).toBe(1)
  expect(started.value.run.rootSessionID).toBe("root")
  expect(started.value.run.ownerDirectory).toBe(owner)
  expect(harness.storage.writes()).toBe(1)
  expect(harness.notifyWriteCounts()).toEqual([1])

  const replay = await harness.callTool<{ duplicate: boolean }>("execution_report", fixtureStart(), root)
  expect(replay.ok).toBe(true)
  if (!replay.ok) return
  expect(replay.value.duplicate).toBe(true)
  expect(harness.storage.writes()).toBe(1)
  expect(harness.changes()).toEqual([{ rootSessionID: "root", runID: "run-1", revision: 1 }])
})

test("a child cannot impersonate the root reporter", async () => {
  const harness = await pluginHarness({ sessions: [{ id: "root" }, { id: "child", parentID: "root" }] })
  const result = await harness.callTool("execution_report", fixtureStart(), { sessionID: "child" })
  expect(result.ok).toBe(false)
  if (result.ok) return
  expect(result.error.code).toBe("forbidden")
  expect(harness.storage.writes()).toBe(0)
})

test("a grandchild and an unrelated family are both refused", async () => {
  const harness = await pluginHarness({
    sessions: [
      { id: "root" },
      { id: "child", parentID: "root" },
      { id: "grandchild", parentID: "child" },
      { id: "other" },
      { id: "other-child", parentID: "other" },
    ],
  })
  const grandchild = await harness.callTool("execution_report", fixtureStart(), { sessionID: "grandchild" })
  expect(grandchild.ok).toBe(false)
  if (grandchild.ok) return
  expect(grandchild.error.code).toBe("forbidden")

  const unrelated = await harness.callTool("execution_report", fixtureStart(), { sessionID: "other-child" })
  expect(unrelated.ok).toBe(false)
  if (unrelated.ok) return
  expect(unrelated.error.code).toBe("forbidden")
  expect(harness.storage.writes()).toBe(0)
})

test("an unrelated root cannot mutate another root's run", async () => {
  const harness = await pluginHarness({ sessions: [{ id: "root" }, { id: "other" }] })
  await startRun(harness, "run-1")
  const result = await harness.callTool("execution_report", fixtureReport(), { sessionID: "other" })
  expect(result.ok).toBe(false)
  if (result.ok) return
  expect(result.error.code).toBe("not_found")
  expect(harness.storage.writes()).toBe(1)
})

test("a caller-supplied principal field is rejected before any native lookup", async () => {
  const harness = await pluginHarness({ sessions: [{ id: "root" }] })
  const forged = { ...fixtureStart(), principal: { sessionID: "root", rootSessionID: "root" }, rootSessionID: "root" }
  const result = await harness.callTool("execution_report", forged, root)
  expect(result.ok).toBe(false)
  if (result.ok) return
  expect(result.error.code).toBe("invalid_input")
  expect(harness.storage.writes()).toBe(0)
  expect(harness.sessionLookups()).toBe(0)
})

test("unknown callers and malformed ancestry never resolve to a trusted root", async () => {
  const unknown = await pluginHarness({ sessions: [{ id: "root" }] })
  const stranger = await unknown.callTool("execution_report", fixtureStart(), { sessionID: "ghost" })
  expect(stranger.ok).toBe(false)
  if (stranger.ok) return
  expect(stranger.error.code).toBe("forbidden")
  expect(unknown.storage.writes()).toBe(0)

  const orphaned = await pluginHarness({ sessions: [{ id: "orphan", parentID: "missing" }] })
  const orphan = await orphaned.callTool("execution_report", fixtureStart(), { sessionID: "orphan" })
  expect(orphan.ok).toBe(false)
  if (orphan.ok) return
  expect(orphan.error.code).toBe("forbidden")

  const cyclic = await pluginHarness({
    sessions: [
      { id: "a", parentID: "b" },
      { id: "b", parentID: "a" },
    ],
  })
  const cycle = await cyclic.callTool("execution_report", fixtureStart(), { sessionID: "a" })
  expect(cycle.ok).toBe(false)
  if (cycle.ok) return
  expect(cycle.error.code).toBe("forbidden")
})

test("a root session recorded at another location is refused", async () => {
  const harness = await pluginHarness({ sessions: [{ id: "root", directory: "/root/git/other" }] })
  const result = await harness.callTool("execution_report", fixtureStart(), root)
  expect(result.ok).toBe(false)
  if (result.ok) return
  expect(result.error.code).toBe("forbidden")
  expect(harness.storage.writes()).toBe(0)
})

test("a failed native lookup is not cached and a later call succeeds", async () => {
  const harness = await pluginHarness({ sessions: [{ id: "root" }] })
  harness.failNextSessionGet()
  const failed = await harness.callTool("execution_report", fixtureStart(), root)
  expect(failed.ok).toBe(false)
  if (failed.ok) return
  expect(failed.error.code).toBe("forbidden")

  const recovered = await harness.callTool("execution_report", fixtureStart(), root)
  expect(recovered.ok).toBe(true)
  expect(harness.storage.writes()).toBe(1)
})

test("assignment and evidence sessions must belong to the reported run", async () => {
  const harness = await pluginHarness({
    sessions: [
      { id: "root" },
      { id: "child", parentID: "root" },
      { id: "stranger" },
      { id: "other-child", parentID: "stranger" },
    ],
  })
  await startRun(harness, "run-1")

  const accepted: ReportCommand = {
    operationID: "op-assign",
    runID: "run-1",
    expectedRevision: 1,
    operation: { type: "assignment.add", id: "a1", taskID: "task-a", attempt: 1, sessionID: "child", role: "implementer" },
  }
  const assignment = await harness.callTool("execution_report", accepted, root)
  expect(assignment.ok).toBe(true)
  expect(harness.storage.writes()).toBe(2)

  const foreign: ReportCommand = {
    operationID: "op-assign-foreign",
    runID: "run-1",
    expectedRevision: 2,
    operation: { type: "assignment.add", id: "a2", taskID: "task-a", attempt: 1, sessionID: "other-child", role: "implementer" },
  }
  const rejected = await harness.callTool("execution_report", foreign, root)
  expect(rejected.ok).toBe(false)
  if (rejected.ok) return
  expect(rejected.error.code).toBe("forbidden")
  expect(harness.storage.writes()).toBe(2)

  const missingSession: ReportCommand = {
    operationID: "op-assign-ghost",
    runID: "run-1",
    expectedRevision: 2,
    operation: { type: "assignment.add", id: "a3", taskID: "task-a", attempt: 1, sessionID: "ghost", role: "implementer" },
  }
  const unknown = await harness.callTool("execution_report", missingSession, root)
  expect(unknown.ok).toBe(false)
  if (unknown.ok) return
  expect(unknown.error.code).toBe("forbidden")
  expect(harness.storage.writes()).toBe(2)

  const evidence: ReportCommand = {
    operationID: "op-evidence",
    runID: "run-1",
    expectedRevision: 2,
    operation: {
      type: "evidence.add",
      id: "ev-1",
      taskID: "task-a",
      attempt: 1,
      gate: "tests",
      outcome: "passed",
      summary: "tests pass",
      sessionID: "child",
      messageID: "message-1",
    },
  }
  const recorded = await harness.callTool("execution_report", evidence, root)
  expect(recorded.ok).toBe(true)
  expect(harness.storage.writes()).toBe(3)

  const foreignEvidence: ReportCommand = {
    operationID: "op-evidence-foreign",
    runID: "run-1",
    expectedRevision: 3,
    operation: {
      type: "evidence.add",
      id: "ev-2",
      taskID: "task-a",
      attempt: 1,
      gate: "tests",
      outcome: "passed",
      summary: "tests pass",
      sessionID: "stranger",
      messageID: "message-1",
    },
  }
  const refused = await harness.callTool("execution_report", foreignEvidence, root)
  expect(refused.ok).toBe(false)
  if (refused.ok) return
  expect(refused.error.code).toBe("forbidden")
  expect(harness.storage.writes()).toBe(3)
})

test("repository failures surface as structured tool errors", async () => {
  const harness = await pluginHarness({ sessions: [{ id: "root" }] })
  await startRun(harness, "run-1")

  const conflict = await harness.callTool("execution_report", fixtureReport({ operationID: "op-conflict", expectedRevision: 99 }), root)
  expect(conflict.ok).toBe(false)
  if (conflict.ok) return
  expect(conflict.error.code).toBe("revision_conflict")
  expect(conflict.error.currentRevision).toBe(1)

  const verify: ReportCommand = {
    operationID: "op-verify",
    runID: "run-1",
    expectedRevision: 1,
    operation: { type: "task.verify", taskID: "task-a", attempt: 1 },
  }
  const transition = await harness.callTool("execution_report", verify, root)
  expect(transition.ok).toBe(false)
  if (transition.ok) return
  expect(transition.error.code).toBe("invalid_transition")

  const missing = await harness.callTool("execution_read", { runID: "missing" }, root)
  expect(missing.ok).toBe(false)
  if (missing.ok) return
  expect(missing.error.code).toBe("not_found")
  expect(harness.storage.writes()).toBe(1)
})

test("a failed durable write reports storage_unavailable and emits no change", async () => {
  const harness = await pluginHarness({ sessions: [{ id: "root" }] })
  await startRun(harness, "run-1")
  harness.storage.failNextSet()
  const failed = await harness.callTool("execution_report", fixtureReport({ operationID: "op-failed" }), root)
  expect(failed.ok).toBe(false)
  if (failed.ok) return
  expect(failed.error.code).toBe("storage_unavailable")
  expect(harness.storage.writes()).toBe(1)
  expect(harness.changes()).toHaveLength(1)
})

test("execution_read returns the active run and the requested historical run", async () => {
  const harness = await pluginHarness({ sessions: [{ id: "root" }] })
  await startRun(harness, "run-1")

  const active = await harness.callTool<{ run: RunSnapshot | null }>("execution_read", {}, root)
  expect(active.ok).toBe(true)
  if (!active.ok) return
  expect(active.value.run?.runID).toBe("run-1")
  expect(active.value.run?.status).toBe("active")

  const child = await pluginHarness({ sessions: [{ id: "root" }, { id: "child", parentID: "root" }] })
  await startRun(child, "run-1")
  const descendant = await child.callTool<{ run: RunSnapshot | null }>("execution_read", {}, { sessionID: "child" })
  expect(descendant.ok).toBe(true)
  if (!descendant.ok) return
  expect(descendant.value.run?.runID).toBe("run-1")

  await cancelRun(harness, "run-1")
  const idle = await harness.callTool<{ run: RunSnapshot | null }>("execution_read", {}, root)
  expect(idle.ok).toBe(true)
  if (!idle.ok) return
  expect(idle.value.run).toBeNull()

  const historical = await harness.callTool<{ run: RunSnapshot | null }>("execution_read", { runID: "run-1" }, root)
  expect(historical.ok).toBe(true)
  if (!historical.ok) return
  expect(historical.value.run?.status).toBe("cancelled")
})

test("capabilities declares the schema version, plugin identity, and controller-only reporting", async () => {
  const harness = await pluginHarness({ sessions: [{ id: "root" }] })
  const result = await harness.callRpc<{
    schemaVersion: number
    pluginVersion: string
    maxTasks: number
    reporting: string
  }>("capabilities", {})
  expect(result.ok).toBe(true)
  if (!result.ok) return
  expect(result.value).toEqual({ schemaVersion: 1, pluginVersion, maxTasks: 500, reporting: "controller" })
})

test("listRuns paginates by run id with a stable cursor", async () => {
  const harness = await pluginHarness({ sessions: [{ id: "root" }] })
  await startRun(harness, "run-1")
  await cancelRun(harness, "run-1")
  await startRun(harness, "run-2")
  await cancelRun(harness, "run-2")
  await startRun(harness, "run-3")

  const first = await harness.callRpc<{ items: RunSummary[]; next?: string }>("listRuns", {
    rootSessionID: "root",
    limit: 2,
  })
  expect(first.ok).toBe(true)
  if (!first.ok) return
  expect(first.value.items.map((item) => item.runID)).toEqual(["run-1", "run-2"])
  expect(first.value.next).toBe("run-2")

  const second = await harness.callRpc<{ items: RunSummary[]; next?: string }>("listRuns", {
    rootSessionID: "root",
    after: first.value.next,
    limit: 2,
  })
  expect(second.ok).toBe(true)
  if (!second.ok) return
  expect(second.value.items.map((item) => item.runID)).toEqual(["run-3"])
  expect(second.value.next).toBeUndefined()
})

test("getRun and getSummaries return stored snapshots and reject unreadable records", async () => {
  const harness = await pluginHarness({ sessions: [{ id: "root" }] })
  await startRun(harness, "run-1")

  const run = await harness.callRpc<RunSnapshot>("getRun", { rootSessionID: "root", runID: "run-1" })
  expect(run.ok).toBe(true)
  if (!run.ok) return
  expect(run.value.runID).toBe("run-1")

  const summaries = await harness.callRpc<{ items: RunSummary[] }>("getSummaries", { rootSessionIDs: ["root", "absent"] })
  expect(summaries.ok).toBe(true)
  if (!summaries.ok) return
  expect(summaries.value.items.map((item) => item.runID)).toEqual(["run-1"])

  const corrupt = await pluginHarness({ sessions: [{ id: "root" }] })
  corrupt.storage.seed(runKey(owner, "root", "run-1"), { snapshot: { bogus: true }, receipts: [] })
  const failed = await corrupt.callRpc("getRun", { rootSessionID: "root", runID: "run-1" })
  expect(failed.ok).toBe(false)
  if (failed.ok) return
  expect(failed.failure.type).toBe("execution")
  expect(failed.failure.data?.code).toBe("incompatible_schema")
})

test("the read RPC exposes no mutation method", async () => {
  const harness = await pluginHarness({ sessions: [{ id: "root" }] })
  expect(harness.definition.id).toBe("superpowers.execution.v1")
  expect(Object.keys(harness.definition.methods).sort()).toEqual(["capabilities", "getRun", "getSummaries", "listRuns"])
  expect(Object.keys(harness.definition.events)).toEqual(["changed"])
})

test("unloading unregisters tools and the RPC, closes the writer, and is idempotent", async () => {
  const harness = await pluginHarness({ sessions: [{ id: "root" }] })
  await startRun(harness, "run-1")
  await harness.dispose()
  await harness.dispose()

  expect(harness.toolNames()).toEqual([])
  expect(harness.disposeCounts()).toEqual({ rpc: 1, tools: 1 })

  const rpc = await harness.callRpc("capabilities", {})
  expect(rpc.ok).toBe(false)
  if (rpc.ok) return
  expect(rpc.failure.type).toBe("rpc.method_not_found")

  const after = await harness.invokeCapturedTool("execution_report", fixtureStart({ operationID: "op-after" }), root)
  expect(after.ok).toBe(false)
  if (after.ok) return
  expect(after.error.code).toBe("storage_unavailable")
  expect(harness.storage.writes()).toBe(1)
})

test("setup registers one RPC and one tool transform without an event, socket, or HTTP surface", async () => {
  const harness = await pluginHarness({ sessions: [{ id: "root" }] })
  expect(harness.registrations()).toEqual({ rpc: 1, toolTransforms: 1 })
  const accesses = new Set(harness.hostAccesses())
  expect(accesses.has("storage")).toBe(true)
  expect(accesses.has("session")).toBe(true)
  for (const unavailable of ["event", "experimental", "generate", "websearch", "mcp", "worktree", "provider"]) {
    expect(accesses.has(unavailable)).toBe(false)
  }
})
