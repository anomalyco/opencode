import { expect, test } from "bun:test"
import { summarizeProgress } from "../src/progress"
import { DomainError, applyReport, validateTaskGraph, type ReportContext } from "../src/reducer"
import type { Gate, ReportCommand, ReportOperation, RunSnapshot, Task, TaskDefinition } from "../src/schema"
import {
  fixtureComplete,
  fixtureDefinition,
  fixtureDefinitions,
  fixtureFailure,
  fixturePlan,
  fixtureReopened,
  fixtureReport,
  fixtureScopeChange,
  fixtureStart,
  fixtureTask,
} from "./fixtures"

const context: ReportContext = { rootSessionID: "root", ownerDirectory: "/root/git/demo", now: 1_000 }

let operationSeq = 0
let evidenceSeq = 0

test("awaiting review is not verified and skipped work is explicit", () => {
  const value = summarizeProgress([
    fixtureTask({ id: "a", state: "verified" }),
    fixtureTask({ id: "b", state: "awaiting_review" }),
    fixtureTask({ id: "c", state: "skipped", reason: "Approved scope reduction" }),
  ])
  expect(value).toMatchObject({ verified: 1, total: 2, skipped: 1, percent: 50, source: "controller_report" })
  expect(summarizeProgress([]).percent).toBeNull()
})

test("scenario fixtures expose complete, failed, reopened, and revised runs", () => {
  expect(summarizeProgress(fixtureComplete().tasks)).toMatchObject({ verified: 3, total: 3, skipped: 0, percent: 100 })
  expect(fixtureComplete().status).toBe("completed")
  expect(summarizeProgress(fixtureFailure().tasks)).toMatchObject({ verified: 1, total: 2, failed: 1, percent: 50 })
  expect(summarizeProgress(fixtureReopened().tasks)).toMatchObject({ verified: 0, total: 2, percent: 0 })
  expect(summarizeProgress(fixtureScopeChange().tasks)).toMatchObject({ skipped: 1, total: 2, percent: 50 })
  expect(fixtureReopened().tasks[0]?.attempt).toBe(2)
})

test("task graph validation rejects duplicate, self, missing, and cyclic references", () => {
  expect(codeOf(() => validateTaskGraph(fixtureDefinitions()))).toBeUndefined()
  expect(codeOf(() => validateTaskGraph([fixtureDefinition({ id: "x" }), fixtureDefinition({ id: "x" })]))).toBe("invalid_input")
  expect(codeOf(() => validateTaskGraph([fixtureDefinition({ id: "x", dependsOn: ["x"] })]))).toBe("invalid_input")
  expect(codeOf(() => validateTaskGraph([fixtureDefinition({ id: "x", dependsOn: ["y"] })]))).toBe("invalid_input")
  const cyclic = [fixtureDefinition({ id: "x", dependsOn: ["y"] }), fixtureDefinition({ id: "y", dependsOn: ["x"] })]
  expect(codeOf(() => validateTaskGraph(cyclic))).toBe("invalid_input")
})

test("five hundred node graphs reject cycles and duplicate ids", () => {
  const chain = Array.from({ length: 500 }, (_, index) =>
    fixtureDefinition({ id: `task-${index}`, dependsOn: index === 0 ? [] : [`task-${index - 1}`] }),
  )
  expect(codeOf(() => validateTaskGraph(chain))).toBeUndefined()
  const cycle = chain.map((task, index) => ({ ...task, dependsOn: [`task-${(index + 1) % 500}`] }))
  expect(codeOf(() => validateTaskGraph(cycle))).toBe("invalid_input")
  const duplicate = [...chain.slice(0, 499), { ...chain[499], id: "task-0" } as TaskDefinition]
  expect(codeOf(() => validateTaskGraph(duplicate))).toBe("invalid_input")
})

test("run.start validates the graph and initializes pending tasks at revision one", () => {
  const run = start()
  expect(run).toMatchObject({
    schemaVersion: 1,
    runID: "run-1",
    rootSessionID: "root",
    ownerDirectory: "/root/git/demo",
    revision: 1,
    status: "active",
    createdAt: 1_000,
    updatedAt: 1_000,
    assignments: [],
    evidence: [],
  })
  expect(run.plan.revision).toBe(1)
  expect(run.tasks.map((task) => [task.id, task.state, task.attempt])).toEqual([
    ["spec", "pending", 1],
    ["impl", "pending", 1],
    ["review", "pending", 1],
    ["docs", "pending", 1],
  ])
  expect(run.events).toEqual([{ revision: 1, type: "run.start", summary: "Execution run started", createdAt: 1_000 }])
})

test("run identity and expected revision mismatches are structured errors", () => {
  const run = start()
  expect(codeOf(() => applyReport(run, { ...fixtureReport(), expectedRevision: 7 }, context))).toBe("revision_conflict")
  expect(codeOf(() => applyReport(run, { ...fixtureReport(), runID: "other" }, context))).toBe("not_found")
  expect(codeOf(() => applyReport(undefined, fixtureReport(), context))).toBe("not_found")
  expect(codeOf(() => applyReport(run, fixtureStart(), context))).toBe("operation_conflict")
  expect(codeOf(() => applyReport(undefined, fixtureStart({ expectedRevision: 1 }), context))).toBe("revision_conflict")
})

test("task state transitions follow the section 8 table", () => {
  let run = startSingle()
  run = report(run, { type: "task.state", taskID: "task-a", attempt: 1, state: "running" })
  expect(taskOf(run, "task-a").state).toBe("running")
  run = report(run, { type: "task.state", taskID: "task-a", attempt: 1, state: "awaiting_review", reason: "ready" })
  run = report(run, { type: "task.state", taskID: "task-a", attempt: 1, state: "running" })
  run = report(run, { type: "task.state", taskID: "task-a", attempt: 1, state: "blocked", reason: "waiting" })
  run = report(run, { type: "task.state", taskID: "task-a", attempt: 1, state: "running" })
  expect(taskOf(run, "task-a").reason).toBeUndefined()
  run = report(run, { type: "task.state", taskID: "task-a", attempt: 1, state: "failed", reason: "red" })
  expect(taskOf(run, "task-a")).toMatchObject({ state: "failed", reason: "red" })
  expect(codeOf(() => report(run, { type: "task.state", taskID: "task-a", attempt: 1, state: "running" }))).toBe("invalid_transition")
})

test("awaiting review can fail or verify", () => {
  let failed = report(startSingle(), { type: "task.state", taskID: "task-a", attempt: 1, state: "running" })
  failed = report(failed, { type: "task.state", taskID: "task-a", attempt: 1, state: "awaiting_review" })
  failed = report(failed, { type: "task.state", taskID: "task-a", attempt: 1, state: "failed", reason: "review rejected" })
  expect(taskOf(failed, "task-a")).toMatchObject({ state: "failed", reason: "review rejected" })

  let verified = report(startSingle(), { type: "task.state", taskID: "task-a", attempt: 1, state: "running" })
  verified = report(verified, { type: "task.state", taskID: "task-a", attempt: 1, state: "awaiting_review" })
  verified = verify(verified, "task-a")
  expect(taskOf(verified, "task-a")).toMatchObject({ state: "verified", attempt: 1 })
})

test("denied transitions are rejected instead of repaired", () => {
  const pending = startSingle()
  expect(codeOf(() => report(pending, { type: "task.state", taskID: "task-a", attempt: 1, state: "awaiting_review" }))).toBe("invalid_transition")
  expect(codeOf(() => report(pending, { type: "task.state", taskID: "task-a", attempt: 1, state: "failed", reason: "x" }))).toBe("invalid_transition")
  const blocked = report(pending, { type: "task.state", taskID: "task-a", attempt: 1, state: "blocked", reason: "waiting" })
  expect(taskOf(blocked, "task-a").state).toBe("blocked")
  expect(codeOf(() => report(blocked, { type: "task.state", taskID: "task-a", attempt: 1, state: "awaiting_review" }))).toBe("invalid_transition")
  expect(codeOf(() => report(blocked, { type: "task.state", taskID: "task-a", attempt: 1, state: "failed", reason: "x" }))).toBe("invalid_transition")
  expect(taskOf(report(blocked, { type: "task.state", taskID: "task-a", attempt: 1, state: "running" }), "task-a").state).toBe("running")
})

test("unknown tasks and stale attempts are rejected", () => {
  const run = startSingle()
  expect(codeOf(() => report(run, { type: "task.state", taskID: "missing", attempt: 1, state: "running" }))).toBe("not_found")
  expect(codeOf(() => report(run, { type: "task.state", taskID: "task-a", attempt: 2, state: "running" }))).toBe("stale_attempt")
  expect(codeOf(() => report(run, { type: "task.verify", taskID: "task-a", attempt: 2 }))).toBe("stale_attempt")
  expect(codeOf(() => report(run, evidence("task-a", 2, "tests", "passed")))).toBe("stale_attempt")
  expect(codeOf(() => report(run, { type: "assignment.add", id: "assign-1", taskID: "task-a", attempt: 2, sessionID: "child", role: "implementer" }))).toBe("stale_attempt")
})

test("starting work requires verified dependencies", () => {
  let run = start()
  expect(codeOf(() => report(run, { type: "task.state", taskID: "impl", attempt: 1, state: "running" }))).toBe("invalid_transition")
  run = verify(run, "spec")
  expect(taskOf(report(run, { type: "task.state", taskID: "impl", attempt: 1, state: "running" }), "impl").state).toBe("running")
  expect(taskOf(report(run, { type: "task.state", taskID: "docs", attempt: 1, state: "running" }), "docs").state).toBe("running")
})

test("verification requires the latest evidence per gate on the current attempt", () => {
  let run = startSingle(false, ["tests", "manual"])
  run = report(run, { type: "task.state", taskID: "task-a", attempt: 1, state: "running" })
  run = report(run, evidence("task-a", 1, "tests", "passed"))
  expect(codeOf(() => report(run, { type: "task.verify", taskID: "task-a", attempt: 1 }))).toBe("invalid_transition")
  run = report(run, evidence("task-a", 1, "manual", "passed"))
  run = report(run, evidence("task-a", 1, "tests", "failed"))
  expect(codeOf(() => report(run, { type: "task.verify", taskID: "task-a", attempt: 1 }))).toBe("invalid_transition")
  run = report(run, evidence("task-a", 1, "tests", "passed"))
  run = report(run, { type: "task.verify", taskID: "task-a", attempt: 1 })
  expect(taskOf(run, "task-a")).toMatchObject({ state: "verified", attempt: 1 })
  expect(codeOf(() => report(run, { type: "task.state", taskID: "task-a", attempt: 1, state: "running" }))).toBe("invalid_transition")
})

test("verification requires resolved dependencies", () => {
  const run = start()
  expect(codeOf(() => report(run, { type: "task.verify", taskID: "impl", attempt: 1 }))).toBe("invalid_transition")
})

test("evidence records trusted provenance and rejects duplicate ids", () => {
  let run = startSingle()
  run = report(run, evidence("task-a", 1, "tests", "passed", "ev-1"))
  expect(run.evidence[0]).toMatchObject({ id: "ev-1", reportedBySessionID: "root", sessionID: "child", createdAt: 1_000 })
  expect(codeOf(() => report(run, evidence("task-a", 1, "tests", "passed", "ev-1")))).toBe("operation_conflict")
})

test("assignments open and end once on the current attempt", () => {
  let run = startSingle()
  run = report(run, { type: "assignment.add", id: "assign-1", taskID: "task-a", attempt: 1, sessionID: "child", role: "implementer" })
  expect(run.assignments[0]).toMatchObject({ id: "assign-1", taskID: "task-a", attempt: 1, sessionID: "child", role: "implementer", createdAt: 1_000 })
  expect(run.assignments[0]?.endedAt).toBeUndefined()
  expect(codeOf(() => report(run, { type: "assignment.add", id: "assign-1", taskID: "task-a", attempt: 1, sessionID: "child", role: "implementer" }))).toBe("operation_conflict")
  run = report(run, { type: "assignment.end", assignmentID: "assign-1" })
  expect(run.assignments[0]?.endedAt).toBe(1_000)
  expect(codeOf(() => report(run, { type: "assignment.end", assignmentID: "assign-1" }))).toBe("operation_conflict")
  expect(codeOf(() => report(run, { type: "assignment.end", assignmentID: "assign-missing" }))).toBe("not_found")
})

test("plan revision rejects an active dependency on omitted work", () => {
  const run = start()
  const cut: TaskDefinition[] = [
    fixtureDefinition({ id: "impl", title: "Implement", order: 0, dependsOn: ["spec"] }),
    fixtureDefinition({ id: "review", title: "Final review", order: 1, dependsOn: ["impl"], requiredGates: ["spec_review", "code_review"], finalReview: true }),
  ]
  expect(codeOf(() => report(run, { type: "plan.revise", plan: fixturePlan, tasks: cut, reason: "drop spec" }))).toBe("invalid_input")
  const repaired = cut.map((task): TaskDefinition => (task.id === "impl" ? { ...task, dependsOn: [] } : task))
  const revised = report(run, { type: "plan.revise", plan: fixturePlan, tasks: repaired, reason: "drop spec" })
  expect(revised.plan.revision).toBe(2)
  expect(taskOf(revised, "spec")).toMatchObject({ state: "skipped", reason: "drop spec" })
})

test("plan revision must replace a removed final-review task", () => {
  const run = start()
  const withoutReview = fixtureDefinitions().filter((task) => task.id !== "review")
  expect(codeOf(() => report(run, { type: "plan.revise", plan: fixturePlan, tasks: withoutReview, reason: "drop review" }))).toBe("invalid_input")
  const replacement = withoutReview.concat(
    fixtureDefinition({ id: "signoff", title: "Sign off", order: 4, dependsOn: [], requiredGates: ["manual"], finalReview: true }),
  )
  expect(report(run, { type: "plan.revise", plan: fixturePlan, tasks: replacement, reason: "new signoff" }).plan.revision).toBe(2)
})

test("metadata-only plan edits preserve verification", () => {
  let run = report(undefined, { type: "run.start", title: "Execution run", plan: fixturePlan, tasks: single() })
  run = verify(run, "task-a")
  const before = run.revision
  run = report(run, {
    type: "plan.revise",
    plan: fixturePlan,
    tasks: [fixtureDefinition({ id: "task-a", title: "Renamed", phase: "Phase 2", order: 9, dependsOn: [], requiredGates: ["tests"] })],
    reason: "rename",
  })
  expect(taskOf(run, "task-a")).toMatchObject({ state: "verified", attempt: 1, title: "Renamed", phase: "Phase 2", order: 9 })
  expect(run.plan.revision).toBe(2)
  expect(run.revision).toBe(before + 1)
})

test("changed gates and dependencies invalidate the affected closure", () => {
  let run = start()
  run = verifyAll(run)
  expect(summarizeProgress(run.tasks).percent).toBe(100)
  const gateChange = fixtureDefinitions().map((task): TaskDefinition =>
    task.id === "spec" ? { ...task, requiredGates: ["tests", "manual"] } : task,
  )
  run = report(run, { type: "plan.revise", plan: fixturePlan, tasks: gateChange, reason: "add gate" })
  expect(taskOf(run, "spec")).toMatchObject({ state: "pending", attempt: 2 })
  expect(taskOf(run, "impl")).toMatchObject({ state: "pending", attempt: 2 })
  expect(taskOf(run, "review")).toMatchObject({ state: "pending", attempt: 2 })
  expect(taskOf(run, "docs")).toMatchObject({ state: "verified", attempt: 1 })
  expect(summarizeProgress(run.tasks)).toMatchObject({ verified: 1, total: 4, percent: 25 })
})

test("plan revision closes assignments for invalidated and removed work", () => {
  let run = start()
  run = verify(run, "spec")
  run = verify(run, "impl")
  run = report(run, { type: "assignment.add", id: "assign-impl", taskID: "impl", attempt: 1, sessionID: "child", role: "implementer" })
  run = report(run, { type: "assignment.add", id: "assign-docs", taskID: "docs", attempt: 1, sessionID: "child", role: "implementer" })
  const evidenceBefore = run.evidence.length
  const trimmed = fixtureDefinitions()
    .filter((task) => task.id !== "docs")
    .map((task): TaskDefinition => (task.id === "spec" ? { ...task, requiredGates: ["tests", "manual"] } : task))
  const revised = report(run, { type: "plan.revise", plan: fixturePlan, tasks: trimmed, reason: "tighten gates" })
  expect(taskOf(revised, "docs")).toMatchObject({ state: "skipped", reason: "tighten gates" })
  expect(revised.assignments).toHaveLength(2)
  expect(revised.assignments.map((assignment) => assignment.id)).toEqual(["assign-impl", "assign-docs"])
  expect(revised.assignments.every((assignment) => assignment.endedAt === 1_000)).toBe(true)
  expect(revised.evidence).toHaveLength(evidenceBefore)
  expect(taskOf(revised, "spec").attempt).toBe(2)
  expect(taskOf(revised, "impl").attempt).toBe(2)
})

test("omitted tasks stay as skipped history and reintroduction starts a new attempt", () => {
  let run = start()
  run = verifyAll(run)
  const withoutDocs: TaskDefinition[] = fixtureDefinitions().filter((task) => task.id !== "docs")
  run = report(run, { type: "plan.revise", plan: fixturePlan, tasks: withoutDocs, reason: "defer docs" })
  expect(taskOf(run, "docs")).toMatchObject({ state: "skipped", reason: "defer docs", attempt: 1 })
  expect(summarizeProgress(run.tasks)).toMatchObject({ skipped: 1, verified: 3, total: 3, percent: 100 })
  run = report(run, { type: "plan.revise", plan: fixturePlan, tasks: fixtureDefinitions(), reason: "restore docs" })
  expect(taskOf(run, "docs")).toMatchObject({ state: "pending", attempt: 2 })
  expect(taskOf(run, "docs").reason).toBeUndefined()
})

test("reopening a verified ancestor invalidates dependents and preserves independent work", () => {
  let run = start()
  run = report(run, { type: "assignment.add", id: "assign-impl", taskID: "impl", attempt: 1, sessionID: "child", role: "implementer" })
  run = verifyAll(run)
  const evidenceBefore = run.evidence.length
  run = report(run, { type: "task.reopen", taskID: "spec", reason: "contract changed" })
  expect(taskOf(run, "spec")).toMatchObject({ state: "pending", attempt: 2 })
  expect(taskOf(run, "impl")).toMatchObject({ state: "pending", attempt: 2 })
  expect(taskOf(run, "review")).toMatchObject({ state: "pending", attempt: 2 })
  expect(taskOf(run, "docs")).toMatchObject({ state: "verified", attempt: 1 })
  expect(run.evidence).toHaveLength(evidenceBefore)
  expect(run.assignments[0]?.endedAt).toBe(1_000)
  expect(run.events.at(-1)).toMatchObject({ type: "task.reopen", taskID: "spec" })
  expect(summarizeProgress(run.tasks)).toMatchObject({ verified: 1, total: 4, percent: 25 })
})

test("reopen applies to non-skipped work only", () => {
  let run = startSingle()
  run = report(run, { type: "task.state", taskID: "task-a", attempt: 1, state: "running" })
  run = report(run, { type: "task.state", taskID: "task-a", attempt: 1, state: "failed", reason: "red" })
  run = report(run, { type: "task.reopen", taskID: "task-a", reason: "retry" })
  expect(taskOf(run, "task-a")).toMatchObject({ state: "pending", attempt: 2 })
  expect(taskOf(run, "task-a").reason).toBeUndefined()
  const skipped = report(run, { type: "plan.revise", plan: fixturePlan, tasks: [], reason: "cut all" })
  expect(taskOf(skipped, "task-a").state).toBe("skipped")
  expect(codeOf(() => report(skipped, { type: "task.reopen", taskID: "task-a", reason: "back" }))).toBe("invalid_transition")
})

test("run.finish requires every included task verified", () => {
  const run = start()
  expect(codeOf(() => report(run, { type: "run.finish" }))).toBe("invalid_transition")
})

test("run.finish requires a verified final-review task", () => {
  let run = report(undefined, { type: "run.start", title: "Execution run", plan: fixturePlan, tasks: single(false) })
  run = verify(run, "task-a")
  expect(codeOf(() => report(run, { type: "run.finish" }))).toBe("invalid_transition")
})

test("run.finish completes a fully verified run and closes assignments", () => {
  let run = start()
  run = report(run, { type: "assignment.add", id: "assign-impl", taskID: "impl", attempt: 1, sessionID: "child", role: "implementer" })
  run = verifyAll(run)
  run = report(run, { type: "run.finish" })
  expect(run.status).toBe("completed")
  expect(run.assignments.every((assignment) => assignment.endedAt === 1_000)).toBe(true)
  expect(run.events.at(-1)?.type).toBe("run.finish")
  expect(summarizeProgress(run.tasks).percent).toBe(100)
})

test("cancellation closes assignments without rewriting task state", () => {
  let run = start()
  run = report(run, { type: "task.state", taskID: "spec", attempt: 1, state: "running" })
  run = report(run, { type: "assignment.add", id: "assign-spec", taskID: "spec", attempt: 1, sessionID: "child", role: "implementer" })
  const cancelled = report(run, { type: "run.cancel", reason: "stopped" })
  expect(cancelled.status).toBe("cancelled")
  expect(taskOf(cancelled, "spec").state).toBe("running")
  expect(taskOf(cancelled, "impl").state).toBe("pending")
  expect(cancelled.assignments[0]?.endedAt).toBe(1_000)
  expect(cancelled.events.at(-1)?.type).toBe("run.cancel")
})

test("a cancelled run keeps its historical fraction and never reports complete", () => {
  let run = start()
  run = verify(run, "spec")
  run = verify(run, "docs")
  const cancelled = report(run, { type: "run.cancel", reason: "stopped" })
  expect(summarizeProgress(cancelled.tasks).percent).toBe(50)
  expect(cancelled.status).toBe("cancelled")
})

test("completed and cancelled runs are immutable", () => {
  let run = report(undefined, { type: "run.start", title: "Execution run", plan: fixturePlan, tasks: single(true) })
  run = verify(run, "task-a")
  const completed = report(run, { type: "run.finish" })
  expect(completed.status).toBe("completed")
  expect(codeOf(() => report(completed, { type: "task.state", taskID: "task-a", attempt: 1, state: "running" }))).toBe("invalid_transition")
  expect(codeOf(() => report(completed, { type: "run.cancel", reason: "too late" }))).toBe("invalid_transition")
  expect(codeOf(() => report(completed, { type: "plan.revise", plan: fixturePlan, tasks: [], reason: "x" }))).toBe("invalid_transition")

  const cancelled = report(run, { type: "run.cancel", reason: "stopped" })
  expect(cancelled.status).toBe("cancelled")
  expect(codeOf(() => report(cancelled, { type: "run.finish" }))).toBe("invalid_transition")
})

test("accepted reports never mutate the input snapshot", () => {
  const started = start()
  const original = structuredClone(started)
  const run = report(started, { type: "task.state", taskID: "spec", attempt: 1, state: "running" })
  expect(run).not.toBe(started)
  expect(started).toEqual(original)

  const frozen = structuredClone(run)
  deepFreeze(run)
  report(run, { type: "task.state", taskID: "spec", attempt: 1, state: "awaiting_review", reason: "ready" })
  expect(run).toEqual(frozen)
})

test("domain failures are structured errors", () => {
  try {
    applyReport(undefined, fixtureReport(), context)
    throw new Error("expected a domain failure")
  } catch (error) {
    expect(error).toBeInstanceOf(DomainError)
    if (error instanceof DomainError) expect(error.error).toMatchObject({ code: "not_found" })
  }
})

function start(): RunSnapshot {
  return report(undefined, { type: "run.start", title: "Execution run", plan: fixturePlan, tasks: fixtureDefinitions() })
}

function startSingle(finalReview = false, gates: Gate[] = ["tests"]): RunSnapshot {
  return report(undefined, { type: "run.start", title: "Execution run", plan: fixturePlan, tasks: single(finalReview, gates) })
}

function single(finalReview = false, gates: Gate[] = ["tests"]): TaskDefinition[] {
  return [fixtureDefinition({ id: "task-a", title: "Task A", order: 0, dependsOn: [], requiredGates: gates, finalReview })]
}

function report(run: RunSnapshot | undefined, operation: ReportOperation): RunSnapshot {
  operationSeq += 1
  const command: ReportCommand = {
    operationID: `op-${operationSeq}`,
    runID: "run-1",
    expectedRevision: run?.revision ?? 0,
    operation,
  }
  return applyReport(run, command, context)
}

function evidence(taskID: string, attempt: number, gate: Gate, outcome: "passed" | "failed", id?: string): ReportOperation {
  evidenceSeq += 1
  return {
    type: "evidence.add",
    id: id ?? `ev-${evidenceSeq}`,
    taskID,
    attempt,
    gate,
    outcome,
    summary: `${gate} ${outcome}`,
    sessionID: "child",
    messageID: "msg-1",
  }
}

function verify(run: RunSnapshot, taskID: string, attempt = 1): RunSnapshot {
  const task = taskOf(run, taskID)
  const started =
    task.state === "pending" || task.state === "blocked"
      ? report(run, { type: "task.state", taskID, attempt, state: "running" })
      : run
  const withEvidence = taskOf(started, taskID).requiredGates.reduce(
    (acc, gate) => report(acc, evidence(taskID, attempt, gate, "passed")),
    started,
  )
  return report(withEvidence, { type: "task.verify", taskID, attempt })
}

function verifyAll(run: RunSnapshot): RunSnapshot {
  return ["spec", "impl", "review", "docs"].reduce((acc, taskID) => verify(acc, taskID), run)
}

function taskOf(run: RunSnapshot, taskID: string): Task {
  const task = run.tasks.find((candidate) => candidate.id === taskID)
  if (task === undefined) throw new Error(`missing task ${taskID}`)
  return task
}

function codeOf(run: () => unknown): string | undefined {
  try {
    run()
    return undefined
  } catch (error) {
    if (error instanceof DomainError) return error.error.code
    throw error
  }
}

function deepFreeze(value: unknown): void {
  if (value === null || typeof value !== "object") return
  Object.freeze(value)
  for (const child of Object.values(value)) deepFreeze(child)
}
