import { expect, test } from "bun:test"
import type { Assignment, Evidence, TaskDefinition } from "../src/schema"
import {
  AssignmentSchema,
  ChangedSchema,
  ErrorCodeSchema,
  ErrorSchema,
  EvidenceSchema,
  IdentifierSchema,
  PlanHashSchema,
  PlanPathSchema,
  PhaseSchema,
  ProgressSummarySchema,
  ReportCommandSchema,
  RevisionSchema,
  RoleSchema,
  RunEventSchema,
  RunSnapshotSchema,
  RunSummarySchema,
  SummarySchema,
  TaskDefinitionSchema,
  TaskSchema,
  TitleSchema,
} from "../src/schema"
import { fixtureReport, fixtureRun, fixtureStart, fixtureTask } from "./fixtures"

const fetchBefore = globalThis.fetch
const listenersBefore = process.listenerCount("uncaughtException")
const contract = await import("../src/contract")
const fetchAfter = globalThis.fetch
const listenersAfter = process.listenerCount("uncaughtException")

const definition: TaskDefinition = {
  id: "task-a",
  title: "Task A",
  phase: "Phase 1",
  order: 0,
  dependsOn: [],
  requiredGates: ["tests"],
  finalReview: false,
}

const sha256 = "a".repeat(64)
const envelope = (operation: unknown, expectedRevision = 1) => ({
  operationID: "op-1",
  runID: "run-1",
  expectedRevision,
  operation,
})

test("unsupported schema and caller-supplied principal are rejected", () => {
  expect(RunSnapshotSchema.safeParse({ ...fixtureRun(), schemaVersion: 2 }).success).toBe(false)
  expect(ReportCommandSchema.safeParse({ ...fixtureReport(), actorSessionID: "forged" }).success).toBe(false)
})

test("identifiers enforce their exact bounds and alphabet", () => {
  expect(IdentifierSchema.safeParse("a").success).toBe(true)
  expect(IdentifierSchema.safeParse("a".repeat(128)).success).toBe(true)
  expect(IdentifierSchema.safeParse("").success).toBe(false)
  expect(IdentifierSchema.safeParse("a".repeat(129)).success).toBe(false)
  expect(IdentifierSchema.safeParse("with space").success).toBe(false)
  expect(IdentifierSchema.safeParse("slash/id").success).toBe(false)
  expect(IdentifierSchema.safeParse("ok_1-2.3:4").success).toBe(true)
})

test("titles, summaries, and phases cap at their documented lengths", () => {
  expect(TitleSchema.safeParse("t").success).toBe(true)
  expect(TitleSchema.safeParse("t".repeat(200)).success).toBe(true)
  expect(TitleSchema.safeParse("").success).toBe(false)
  expect(TitleSchema.safeParse("t".repeat(201)).success).toBe(false)
  expect(SummarySchema.safeParse("s".repeat(1_000)).success).toBe(true)
  expect(SummarySchema.safeParse("").success).toBe(true)
  expect(SummarySchema.safeParse("s".repeat(1_001)).success).toBe(false)
  expect(PhaseSchema.safeParse("p".repeat(80)).success).toBe(true)
  expect(PhaseSchema.safeParse("").success).toBe(false)
  expect(PhaseSchema.safeParse("p".repeat(81)).success).toBe(false)
})

test("summaries, reasons, and details allow empty text while titles and phases stay nonempty", () => {
  expect(SummarySchema.safeParse("").success).toBe(true)
  expect(ErrorSchema.safeParse({ code: "not_found", detail: "" }).success).toBe(true)
  expect(ErrorSchema.safeParse({ code: "not_found", detail: "d".repeat(1_000) }).success).toBe(true)
  expect(ErrorSchema.safeParse({ code: "not_found", detail: "d".repeat(1_001) }).success).toBe(false)
  expect(TaskSchema.safeParse(fixtureTask({ state: "blocked", reason: "" })).success).toBe(true)
  expect(TaskSchema.safeParse(fixtureTask({ state: "skipped", reason: "" })).success).toBe(true)
  expect(TaskSchema.safeParse(fixtureTask({ state: "blocked" })).success).toBe(false)
  expect(TaskSchema.safeParse(fixtureTask({ state: "blocked", reason: "r".repeat(1_001) })).success).toBe(false)
  expect(TitleSchema.safeParse("").success).toBe(false)
  expect(PhaseSchema.safeParse("").success).toBe(false)
})

test("plan paths stay workspace-relative and bounded", () => {
  expect(PlanPathSchema.safeParse("docs/plan.md").success).toBe(true)
  expect(PlanPathSchema.safeParse(`a/${"b".repeat(1_022)}`).success).toBe(true)
  expect(PlanPathSchema.safeParse(`a/${"b".repeat(1_023)}`).success).toBe(false)
  expect(PlanPathSchema.safeParse("").success).toBe(false)
  expect(PlanPathSchema.safeParse("/etc/passwd").success).toBe(false)
  expect(PlanPathSchema.safeParse("\\server\\share").success).toBe(false)
  expect(PlanPathSchema.safeParse("C:\\plans\\plan.md").success).toBe(false)
  expect(PlanPathSchema.safeParse("../outside.md").success).toBe(false)
  expect(PlanPathSchema.safeParse("docs/../outside.md").success).toBe(false)
  expect(PlanPathSchema.safeParse("docs\\..\\outside.md").success).toBe(false)
  expect(PlanPathSchema.safeParse("..").success).toBe(false)
  expect(PlanPathSchema.safeParse("docs/plan\0.md").success).toBe(false)
})

test("plan hashes are lowercase sha-256 digests", () => {
  expect(PlanHashSchema.safeParse(sha256).success).toBe(true)
  expect(PlanHashSchema.safeParse(sha256.toUpperCase()).success).toBe(false)
  expect(PlanHashSchema.safeParse(sha256.slice(1)).success).toBe(false)
  expect(PlanHashSchema.safeParse(`${sha256}a`).success).toBe(false)
  expect(PlanHashSchema.safeParse("g".repeat(64)).success).toBe(false)
})

test("revisions reject zero, negative, and unsafe values", () => {
  expect(RevisionSchema.safeParse(1).success).toBe(true)
  expect(RevisionSchema.safeParse(Number.MAX_SAFE_INTEGER).success).toBe(true)
  expect(RevisionSchema.safeParse(0).success).toBe(false)
  expect(RevisionSchema.safeParse(-1).success).toBe(false)
  expect(RevisionSchema.safeParse(Number.MAX_SAFE_INTEGER + 1).success).toBe(false)
  expect(RevisionSchema.safeParse(1.5).success).toBe(false)
  expect(ErrorSchema.safeParse({ code: "invalid_input", detail: "bad", currentRevision: 0 }).success).toBe(true)
  expect(ErrorSchema.safeParse({ code: "invalid_input", detail: "bad", currentRevision: -1 }).success).toBe(false)
})

test("task gates, dependencies, attempts, and orders are bounded and unique", () => {
  expect(TaskSchema.safeParse(fixtureTask()).success).toBe(true)
  expect(TaskSchema.safeParse(fixtureTask({ requiredGates: [] })).success).toBe(false)
  expect(TaskSchema.safeParse(fixtureTask({ requiredGates: ["tests", "tests"] })).success).toBe(false)
  expect(TaskSchema.safeParse(fixtureTask({ requiredGates: ["tests", "spec_review", "code_review", "manual"] })).success).toBe(true)
  expect(TaskSchema.safeParse(fixtureTask({ requiredGates: ["other"] as never })).success).toBe(false)
  expect(TaskSchema.safeParse(fixtureTask({ dependsOn: ["a", "a"] })).success).toBe(false)
  expect(TaskSchema.safeParse(fixtureTask({ attempt: 0 })).success).toBe(false)
  expect(TaskSchema.safeParse(fixtureTask({ order: -1 })).success).toBe(false)
  expect(TaskSchema.safeParse({ ...fixtureTask(), extra: true }).success).toBe(false)
})

test("blocked, failed, and skipped tasks require a reason", () => {
  expect(TaskSchema.safeParse(fixtureTask({ state: "blocked" })).success).toBe(false)
  expect(TaskSchema.safeParse(fixtureTask({ state: "failed" })).success).toBe(false)
  expect(TaskSchema.safeParse(fixtureTask({ state: "skipped" })).success).toBe(false)
  expect(TaskSchema.safeParse(fixtureTask({ state: "pending" })).success).toBe(true)
  expect(TaskSchema.safeParse(fixtureTask({ state: "blocked", reason: "Waiting on upstream" })).success).toBe(true)
})

test("task definitions exclude runtime output fields", () => {
  expect(TaskDefinitionSchema.safeParse(definition).success).toBe(true)
  expect(TaskDefinitionSchema.safeParse({ ...definition, state: "pending" }).success).toBe(false)
  expect(TaskDefinitionSchema.safeParse({ ...definition, attempt: 1 }).success).toBe(false)
  expect(TaskDefinitionSchema.safeParse({ ...definition, reason: "why" }).success).toBe(false)
})

test("run snapshot shapes carry bounded collections and server-owned output fields", () => {
  const run = fixtureRun()
  expect(RunSnapshotSchema.safeParse(run).success).toBe(true)
  expect(RunSnapshotSchema.safeParse({ ...run, extra: 1 }).success).toBe(false)
  expect(RunSnapshotSchema.safeParse({ ...run, ownerDirectory: "" }).success).toBe(false)
  expect(RunSnapshotSchema.safeParse({ ...run, tasks: "nope" }).success).toBe(false)
  const tasks = Array.from({ length: 501 }, (_, index) => fixtureTask({ id: `task-${index}` }))
  expect(RunSnapshotSchema.safeParse({ ...run, tasks: tasks.slice(0, 500) }).success).toBe(true)
  expect(RunSnapshotSchema.safeParse({ ...run, tasks }).success).toBe(false)
  const assignments = Array.from(
    { length: 2_001 },
    (_, index): Assignment => ({
      id: `assign-${index}`,
      taskID: "task-a",
      attempt: 1,
      sessionID: "root",
      role: "controller",
      createdAt: 1,
    }),
  )
  expect(RunSnapshotSchema.safeParse({ ...run, assignments: assignments.slice(0, 2_000) }).success).toBe(true)
  expect(RunSnapshotSchema.safeParse({ ...run, assignments }).success).toBe(false)
  const evidence = Array.from(
    { length: 2_001 },
    (_, index): Evidence => ({
      id: `ev-${index}`,
      taskID: "task-a",
      attempt: 1,
      gate: "tests",
      outcome: "passed",
      summary: "passed",
      sessionID: "root",
      messageID: "msg-1",
      reportedBySessionID: "root",
      createdAt: 1,
    }),
  )
  expect(RunSnapshotSchema.safeParse({ ...run, evidence: evidence.slice(0, 2_000) }).success).toBe(true)
  expect(RunSnapshotSchema.safeParse({ ...run, evidence }).success).toBe(false)
})

test("assignments and evidence identify the reporter and attempt", () => {
  const assignment: Assignment = {
    id: "assign-1",
    taskID: "task-a",
    attempt: 1,
    sessionID: "root",
    role: "controller",
    createdAt: 1,
  }
  expect(AssignmentSchema.safeParse(assignment).success).toBe(true)
  expect(AssignmentSchema.safeParse({ ...assignment, role: "owner" }).success).toBe(false)
  expect(RoleSchema.safeParse("code_reviewer").success).toBe(true)
  const evidence: Evidence = {
    id: "ev-1",
    taskID: "task-a",
    attempt: 1,
    gate: "spec_review",
    outcome: "failed",
    summary: "missing coverage",
    sessionID: "child",
    messageID: "msg-2",
    partID: "part-3",
    reportedBySessionID: "root",
    createdAt: 1,
  }
  expect(EvidenceSchema.safeParse(evidence).success).toBe(true)
  expect(EvidenceSchema.safeParse({ ...evidence, outcome: "unknown" }).success).toBe(false)
  expect(EvidenceSchema.safeParse({ ...evidence, messageID: "" }).success).toBe(false)
})

test("run events use report operation names and positive revisions", () => {
  const event = { revision: 2, type: "task.state", taskID: "task-a", summary: "running", createdAt: 2 }
  expect(RunEventSchema.safeParse(event).success).toBe(true)
  expect(RunEventSchema.safeParse({ ...event, type: "streamed" }).success).toBe(false)
  expect(RunEventSchema.safeParse({ ...event, revision: 0 }).success).toBe(false)
})

test("progress summaries distinguish count provenance from percentages", () => {
  const summary = {
    verified: 1,
    total: 2,
    skipped: 1,
    failed: 0,
    blocked: 0,
    awaitingReview: 1,
    percent: 50,
    source: "controller_report",
  }
  expect(ProgressSummarySchema.safeParse(summary).success).toBe(true)
  expect(ProgressSummarySchema.safeParse({ ...summary, percent: null }).success).toBe(true)
  expect(ProgressSummarySchema.safeParse({ ...summary, percent: 101 }).success).toBe(false)
  expect(ProgressSummarySchema.safeParse({ ...summary, source: "guess" }).success).toBe(false)
})

test("run summaries carry plan revision and progress", () => {
  const summary = {
    runID: "run-1",
    rootSessionID: "root",
    ownerDirectory: "/root/git/demo",
    title: "Execution run",
    status: "active",
    revision: 3,
    updatedAt: 1_000,
    planRevision: 1,
    progress: {
      verified: 1,
      total: 2,
      skipped: 0,
      failed: 0,
      blocked: 0,
      awaitingReview: 1,
      percent: 50,
      source: "controller_report",
    },
  }
  expect(RunSummarySchema.safeParse(summary).success).toBe(true)
  expect(RunSummarySchema.safeParse({ ...summary, status: "paused" }).success).toBe(false)
  expect(RunSummarySchema.safeParse({ ...summary, progress: undefined }).success).toBe(false)
})

test("error codes are the agreed store errors with bounded detail", () => {
  const codes = [
    "not_found",
    "invalid_input",
    "forbidden",
    "revision_conflict",
    "operation_conflict",
    "invalid_transition",
    "stale_attempt",
    "limit_exceeded",
    "storage_unavailable",
    "incompatible_schema",
  ]
  for (const code of codes) expect(ErrorCodeSchema.safeParse(code).success).toBe(true)
  expect(ErrorCodeSchema.safeParse("unknown").success).toBe(false)
  expect(ErrorSchema.safeParse({ code: "not_found", detail: "d".repeat(1_000) }).success).toBe(true)
  expect(ErrorSchema.safeParse({ code: "not_found", detail: "d".repeat(1_001) }).success).toBe(false)
  expect(ErrorSchema.safeParse({ code: "not_found", detail: "missing", extra: 1 }).success).toBe(false)
})

test("every report operation has a valid structural fixture", () => {
  const operations = [
    envelope({ type: "run.start", title: "Execution run", plan: { path: "docs/plan.md", sha256 }, tasks: [definition] }, 0),
    envelope({ type: "task.state", taskID: "task-a", attempt: 1, state: "running" }),
    envelope({ type: "task.state", taskID: "task-a", attempt: 1, state: "blocked", reason: "waiting" }),
    envelope({ type: "assignment.add", id: "assign-1", taskID: "task-a", attempt: 1, sessionID: "root", role: "controller" }),
    envelope({ type: "assignment.end", assignmentID: "assign-1" }),
    envelope({
      type: "evidence.add",
      id: "ev-1",
      taskID: "task-a",
      attempt: 1,
      gate: "tests",
      outcome: "passed",
      summary: "suite green",
      sessionID: "child",
      messageID: "msg-1",
    }),
    envelope({ type: "task.verify", taskID: "task-a", attempt: 1 }),
    envelope({ type: "task.reopen", taskID: "task-a", reason: "regression" }),
    envelope({ type: "plan.revise", plan: { path: "docs/plan.md", sha256 }, tasks: [definition], reason: "scope" }),
    envelope({ type: "run.finish" }),
    envelope({ type: "run.cancel", reason: "stopped" }),
  ]
  for (const operation of operations) {
    expect(ReportCommandSchema.safeParse(operation).success).toBe(true)
  }
  expect(ReportCommandSchema.safeParse(fixtureStart()).success).toBe(true)
  expect(ReportCommandSchema.safeParse(fixtureReport()).success).toBe(true)
})

test("malformed and displaced command discriminators are rejected", () => {
  expect(ReportCommandSchema.safeParse(null).success).toBe(false)
  expect(ReportCommandSchema.safeParse("run.start").success).toBe(false)
  expect(ReportCommandSchema.safeParse([]).success).toBe(false)
  expect(ReportCommandSchema.safeParse(envelope(undefined)).success).toBe(false)
  expect(ReportCommandSchema.safeParse(envelope([])).success).toBe(false)
  expect(ReportCommandSchema.safeParse(envelope("task.state")).success).toBe(false)
  expect(ReportCommandSchema.safeParse(envelope({ type: "unknown" })).success).toBe(false)
  expect(ReportCommandSchema.safeParse(envelope({ type: "task.state", taskID: "task-a", attempt: 1, state: "verified" })).success).toBe(false)
  expect(ReportCommandSchema.safeParse(envelope({ type: "task.state", taskID: "task-a", attempt: 1, state: "pending" })).success).toBe(false)
  expect(ReportCommandSchema.safeParse(envelope({ type: "task.state", taskID: "task-a", attempt: 1, state: "blocked" })).success).toBe(false)
  expect(ReportCommandSchema.safeParse(envelope({ type: "run.start", title: "Run", plan: { path: "docs/plan.md", sha256 } })).success).toBe(false)
  expect(ReportCommandSchema.safeParse({ ...fixtureReport(), expectedRevision: -1 }).success).toBe(false)
  expect(ReportCommandSchema.safeParse({ ...fixtureReport(), actorSessionID: "forged" }).success).toBe(false)
  expect(ReportCommandSchema.safeParse({ ...fixtureReport(), operation: { ...fixtureReport().operation, actorSessionID: "forged" } }).success).toBe(false)
})

test("changed invalidation events require an object payload", () => {
  expect(ChangedSchema.safeParse({ rootSessionID: "root", runID: "run-1", revision: 1 }).success).toBe(true)
  expect(ChangedSchema.safeParse({ rootSessionID: "root", runID: "run-1", revision: 0 }).success).toBe(false)
  expect(ChangedSchema.safeParse({ rootSessionID: "root", runID: "run-1" }).success).toBe(false)
  expect(ChangedSchema.safeParse(null).success).toBe(false)
  expect(ChangedSchema.safeParse([]).success).toBe(false)
  expect(ChangedSchema.safeParse("changed").success).toBe(false)
  expect(ChangedSchema.safeParse(1).success).toBe(false)
})

test("read methods bind the four read-only operations with declared execution errors", () => {
  expect(Object.keys(contract.readMethods)).toEqual(["capabilities", "listRuns", "getRun", "getSummaries"])
  for (const method of Object.values(contract.readMethods)) {
    expect(method.errors.execution).toBe(ErrorSchema)
  }
  expect(contract.ExecutionRpc.id).toBe("superpowers.execution.v1")
  expect(Object.keys(contract.ExecutionRpc.events)).toEqual(["changed"])
  expect(contract.ExecutionRpc.events.changed.schema).toBe(ChangedSchema)
})

test("read method inputs enforce their documented bounds", () => {
  const capabilities = contract.readMethods.capabilities.output
  expect(
    capabilities.safeParse({ schemaVersion: 1, pluginVersion: "0.1.0", maxTasks: 500, reporting: "controller" }).success,
  ).toBe(true)
  expect(capabilities.safeParse({ schemaVersion: 2, pluginVersion: "0.1.0", maxTasks: 500, reporting: "controller" }).success).toBe(false)

  const listRuns = contract.readMethods.listRuns.input
  expect(listRuns.safeParse({ rootSessionID: "root" }).success).toBe(true)
  expect(listRuns.safeParse({ rootSessionID: "root", limit: 1 }).success).toBe(true)
  expect(listRuns.safeParse({ rootSessionID: "root", limit: 50, after: "run-1" }).success).toBe(true)
  expect(listRuns.safeParse({ rootSessionID: "root", limit: 0 }).success).toBe(false)
  expect(listRuns.safeParse({ rootSessionID: "root", limit: 51 }).success).toBe(false)
  expect(listRuns.safeParse({ limit: 20 }).success).toBe(false)
  expect(listRuns.safeParse({ rootSessionID: "root", limit: 20.5 }).success).toBe(false)

  const getRun = contract.readMethods.getRun.input
  expect(getRun.safeParse({ rootSessionID: "root", runID: "run-1" }).success).toBe(true)
  expect(getRun.safeParse({ rootSessionID: "root" }).success).toBe(false)
  expect(getRun.safeParse({ rootSessionID: "root", runID: "run-1", ownerDirectory: "/x" }).success).toBe(false)
})

test("summary reads cap root IDs at fifty", () => {
  const getSummaries = contract.readMethods.getSummaries.input
  const roots = (count: number) => Array.from({ length: count }, (_, index) => `root-${index}`)
  expect(getSummaries.safeParse({ rootSessionIDs: roots(50) }).success).toBe(true)
  expect(getSummaries.safeParse({ rootSessionIDs: roots(51) }).success).toBe(false)
  expect(getSummaries.safeParse({ rootSessionIDs: [] }).success).toBe(true)
})

test("contract re-exports one shared progress selector", () => {
  expect(contract.summarizeProgress([]).percent).toBeNull()
  const progress = contract.summarizeProgress([
    fixtureTask({ id: "a", state: "verified" }),
    fixtureTask({ id: "b", state: "awaiting_review" }),
    fixtureTask({ id: "c", state: "skipped", reason: "Approved scope reduction" }),
  ])
  expect(progress).toEqual({
    verified: 1,
    total: 2,
    skipped: 1,
    failed: 0,
    blocked: 0,
    awaitingReview: 1,
    percent: 50,
    source: "controller_report",
  })
})

test("contract load performs no storage, process, or network work", async () => {
  expect(fetchAfter).toBe(fetchBefore)
  expect(listenersAfter).toBe(listenersBefore)
  expect(contract.ExecutionRpc.id).toBe("superpowers.execution.v1")
  const modules = await collectModules(new URL("../src/contract.ts", import.meta.url))
  const allowedSpecifiers = new Set(["zod", "@opencode/schema/rpc"])
  const forbidden = /\bBun\.|\bprocess\.|\bfetch\s*\(|\brequire\s*\(|node:|bun:|setInterval\s*\(|setTimeout\s*\(|WebSocket|XMLHttpRequest/
  for (const module of modules) {
    expect(module.url.pathname).toContain("/superpowers-execution/src/")
    for (const specifier of importSpecifiers(module.source)) {
      if (specifier.startsWith(".")) continue
      expect(allowedSpecifiers.has(specifier)).toBe(true)
    }
    expect(forbidden.test(module.source)).toBe(false)
  }
  const rpcSource = await Bun.file(new URL("../../schema/src/rpc.ts", import.meta.url)).text()
  expect(/import\s+(?!type\b)/.test(rpcSource)).toBe(false)
})

function importSpecifiers(source: string) {
  const specifiers: string[] = []
  for (const match of source.matchAll(/(?:from\s*|import\s*\(\s*)["']([^"']+)["']/g)) {
    if (match[1]) specifiers.push(match[1])
  }
  return specifiers
}

function resolveSpecifier(specifier: string, from: URL) {
  if (!specifier.startsWith(".")) return undefined
  return new URL(specifier.endsWith(".ts") ? specifier : `${specifier}.ts`, from)
}

async function collectModules(entry: URL) {
  const modules = new Map<string, { url: URL; source: string }>()
  const queue = [entry]
  while (queue.length > 0) {
    const url = queue.pop()
    if (!url || modules.has(url.href)) continue
    const source = await Bun.file(url).text()
    modules.set(url.href, { url, source })
    for (const specifier of importSpecifiers(source)) {
      const resolved = resolveSpecifier(specifier, url)
      if (resolved) queue.push(resolved)
    }
  }
  return [...modules.values()]
}
