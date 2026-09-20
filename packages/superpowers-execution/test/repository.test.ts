import { expect, test } from "bun:test"
import { createRunRepository, runKey, type RunAggregate } from "../src/repository"
import { MAX_EVIDENCE, MAX_EVENTS, MAX_RECEIPTS } from "../src/schema"
import {
  fixtureDefinition,
  fixtureEvidence,
  fixturePlan,
  fixtureReport,
  fixtureRun,
  fixtureStart,
  fixtureTask,
  memoryStorage,
} from "./fixtures"

const ownerDirectory = "/root/git/demo"
const principal = { sessionID: "root", rootSessionID: "root" }

test("repeated creation persists once and notifies once", async () => {
  const storage = memoryStorage()
  const changes: number[] = []
  const repository = createRunRepository({
    storage,
    ownerDirectory,
    now: () => 1000,
    onChanged: async (event) => {
      changes.push(event.revision)
    },
  })
  const command = fixtureStart()
  await repository.report(command, principal)
  await repository.report(command, principal)
  expect(storage.writes()).toBe(1)
  expect(changes).toEqual([1])
})

test("a duplicate returns the current snapshot with the original applied revision", async () => {
  const storage = memoryStorage()
  const repository = createRunRepository({ storage, ownerDirectory, now: () => 1000 })
  await repository.report(fixtureStart(), principal)
  await repository.report(fixtureReport({ operationID: "op-two" }), principal)
  const replay = await repository.report(fixtureStart(), principal)
  expect(replay.ok).toBe(true)
  if (!replay.ok) return
  expect(replay.value.duplicate).toBe(true)
  expect(replay.value.appliedRevision).toBe(1)
  expect(replay.value.run.revision).toBe(2)
  expect(storage.writes()).toBe(2)
})

test("reusing an operation id with different input conflicts without mutating", async () => {
  const storage = memoryStorage()
  const repository = createRunRepository({ storage, ownerDirectory, now: () => 1000 })
  await repository.report(fixtureStart(), principal)
  const conflicting = fixtureStart({
    operation: { type: "run.start", title: "Other run", plan: fixturePlan, tasks: [fixtureDefinition()] },
  })
  const result = await repository.report(conflicting, principal)
  expect(result.ok).toBe(false)
  if (result.ok) return
  expect(result.error.code).toBe("operation_conflict")
  expect(storage.writes()).toBe(1)
})

test("simultaneous writes at the same revision serialize with one conflict", async () => {
  const storage = memoryStorage()
  const repository = createRunRepository({ storage, ownerDirectory, now: () => 1000 })
  await repository.report(fixtureStart(), principal)
  const results = await Promise.all([
    repository.report(fixtureReport({ operationID: "op-a" }), principal),
    repository.report(fixtureReport({ operationID: "op-b" }), principal),
  ])
  expect(results.filter((result) => result.ok).length).toBe(1)
  expect(results.map((result) => (result.ok ? undefined : result.error.code))).toContain("revision_conflict")
  expect(storage.writes()).toBe(2)
})

test("simultaneous run starts cannot both activate a run", async () => {
  const storage = memoryStorage()
  const repository = createRunRepository({ storage, ownerDirectory, now: () => 1000 })
  const results = await Promise.all([
    repository.report(fixtureStart({ operationID: "op-a", runID: "run-a" }), principal),
    repository.report(fixtureStart({ operationID: "op-b", runID: "run-b" }), principal),
  ])
  expect(results.filter((result) => result.ok).length).toBe(1)
  expect(results.map((result) => (result.ok ? undefined : result.error.code))).toContain("operation_conflict")
  expect(storage.writes()).toBe(1)
  const runs = await repository.listRuns({ rootSessionID: "root" })
  expect(runs.ok).toBe(true)
  if (runs.ok) expect(runs.value.items.length).toBe(1)
})

test("a non-root principal is forbidden and never reaches storage", async () => {
  const storage = memoryStorage()
  const repository = createRunRepository({ storage, ownerDirectory, now: () => 1000 })
  const result = await repository.report(fixtureStart(), { sessionID: "child", rootSessionID: "root" })
  expect(result.ok).toBe(false)
  if (result.ok) return
  expect(result.error.code).toBe("forbidden")
  expect(storage.writes()).toBe(0)
})

test("a failed storage write publishes no success and no notification", async () => {
  const storage = memoryStorage()
  const changes: number[] = []
  const repository = createRunRepository({
    storage,
    ownerDirectory,
    now: () => 1000,
    onChanged: (event) => {
      changes.push(event.revision)
    },
  })
  storage.failNextSet()
  const result = await repository.report(fixtureStart(), principal)
  expect(result.ok).toBe(false)
  if (result.ok) return
  expect(result.error.code).toBe("storage_unavailable")
  expect(storage.writes()).toBe(0)
  expect(changes).toEqual([])
  expect(await storage.get(runKey(ownerDirectory, "root", "run-1"))).toBeUndefined()
})

test("a write that commits then reports an error is reconciled by read-back", async () => {
  const storage = memoryStorage()
  const changes: number[] = []
  const repository = createRunRepository({
    storage,
    ownerDirectory,
    now: () => 1000,
    onChanged: (event) => {
      changes.push(event.revision)
    },
  })
  storage.failNextSet({ afterWrite: true })
  const result = await repository.report(fixtureStart(), principal)
  expect(result.ok).toBe(true)
  expect(changes).toEqual([1])
  expect(storage.writes()).toBe(1)
  const run = await repository.getRun("root", "run-1")
  expect(run.ok).toBe(true)
  if (run.ok) expect(run.value.revision).toBe(1)
})

test("a read-back that finds no committed record reports storage_unavailable", async () => {
  const storage = memoryStorage()
  const repository = createRunRepository({ storage, ownerDirectory, now: () => 1000 })
  storage.failNextSet()
  storage.failNextGet()
  const result = await repository.report(fixtureStart(), principal)
  expect(result.ok).toBe(false)
  if (result.ok) return
  expect(result.error.code).toBe("storage_unavailable")
})

test("a notifier failure does not roll back the committed write", async () => {
  const storage = memoryStorage()
  const repository = createRunRepository({
    storage,
    ownerDirectory,
    now: () => 1000,
    onChanged: () => {
      throw new Error("notifier down")
    },
  })
  const result = await repository.report(fixtureStart(), principal)
  expect(result.ok).toBe(true)
  expect(storage.writes()).toBe(1)
  const run = await repository.getRun("root", "run-1")
  expect(run.ok).toBe(true)
  if (run.ok) expect(run.value.revision).toBe(1)
})

test("an evicted receipt cannot replay an old revision", async () => {
  const storage = memoryStorage()
  const repository = createRunRepository({ storage, ownerDirectory, now: () => 1000 })
  expect((await repository.report(fixtureStart(), principal)).ok).toBe(true)
  const first = fixtureReport({ operationID: "op-1" })
  expect((await repository.report(first, principal)).ok).toBe(true)
  for (let index = 2; index <= MAX_RECEIPTS + 1; index += 1) {
    const state = index % 2 === 0 ? "awaiting_review" : "running"
    const result = await repository.report(
      fixtureReport({
        operationID: `op-${index}`,
        expectedRevision: index,
        operation: { type: "task.state", taskID: "task-a", attempt: 1, state },
      }),
      principal,
    )
    expect(result.ok).toBe(true)
  }
  const writes = storage.writes()
  const replay = await repository.report(first, principal)
  expect(replay.ok).toBe(false)
  if (replay.ok) return
  expect(replay.error.code).toBe("revision_conflict")
  expect(storage.writes()).toBe(writes)
})

test("listRuns paginates by run id cursor in order", async () => {
  const storage = memoryStorage()
  const repository = createRunRepository({ storage, ownerDirectory, now: () => 1000 })
  for (const id of ["run-a", "run-b", "run-c"]) {
    const started = await repository.report(fixtureStart({ operationID: `op-${id}-start`, runID: id }), principal)
    expect(started.ok).toBe(true)
    const cancelled = await repository.report(
      { operationID: `op-${id}-cancel`, runID: id, expectedRevision: 1, operation: { type: "run.cancel", reason: "done" } },
      principal,
    )
    expect(cancelled.ok).toBe(true)
  }
  const first = await repository.listRuns({ rootSessionID: "root", limit: 2 })
  expect(first.ok).toBe(true)
  if (!first.ok) return
  expect(first.value.items.map((item) => item.runID)).toEqual(["run-a", "run-b"])
  expect(first.value.next).toBe("run-b")
  const second = await repository.listRuns({ rootSessionID: "root", after: first.value.next, limit: 2 })
  expect(second.ok).toBe(true)
  if (!second.ok) return
  expect(second.value.items.map((item) => item.runID)).toEqual(["run-c"])
  expect(second.value.next).toBeUndefined()
})

test("summaries prefer the active run then the latest update and omit empty roots", async () => {
  const storage = memoryStorage()
  const clock = { value: 1000 }
  const repository = createRunRepository({ storage, ownerDirectory, now: () => clock.value })
  const startRun = async (id: string) => {
    clock.value += 1000
    return repository.report(fixtureStart({ operationID: `op-${id}-start`, runID: id }), principal)
  }
  const cancelRun = async (id: string) => {
    clock.value += 1000
    return repository.report(
      { operationID: `op-${id}-cancel`, runID: id, expectedRevision: 1, operation: { type: "run.cancel", reason: "done" } },
      principal,
    )
  }
  await startRun("run-a")
  await cancelRun("run-a")
  await startRun("run-b")
  await cancelRun("run-b")
  const historical = await repository.getSummaries({ rootSessionIDs: ["root"] })
  expect(historical.ok).toBe(true)
  if (historical.ok) expect(historical.value.items.map((item) => item.runID)).toEqual(["run-b"])
  await startRun("run-c")
  const active = await repository.getSummaries({ rootSessionIDs: ["root", "orphan"] })
  expect(active.ok).toBe(true)
  if (!active.ok) return
  expect(active.value.items.map((item) => item.runID)).toEqual(["run-c"])
  expect(active.value.items[0]?.progress.source).toBe("controller_report")
  expect(active.value.items[0]?.planRevision).toBe(1)
})

test("getRun reports not_found and unreadable aggregates as incompatible_schema", async () => {
  const storage = memoryStorage()
  storage.seed(runKey(ownerDirectory, "root", "run-corrupt"), { not: "a run" })
  const repository = createRunRepository({ storage, ownerDirectory, now: () => 1000 })
  const missing = await repository.getRun("root", "run-missing")
  expect(missing.ok).toBe(false)
  if (!missing.ok) expect(missing.error.code).toBe("not_found")
  const corrupt = await repository.getRun("root", "run-corrupt")
  expect(corrupt.ok).toBe(false)
  if (!corrupt.ok) expect(corrupt.error.code).toBe("incompatible_schema")
})

test("storage read failures surface storage_unavailable", async () => {
  const storage = memoryStorage()
  const repository = createRunRepository({ storage, ownerDirectory, now: () => 1000 })
  storage.failNextGet()
  const result = await repository.getRun("root", "run-1")
  expect(result.ok).toBe(false)
  if (!result.ok) expect(result.error.code).toBe("storage_unavailable")
  storage.failNextScan()
  const listed = await repository.listRuns({ rootSessionID: "root" })
  expect(listed.ok).toBe(false)
  if (!listed.ok) expect(listed.error.code).toBe("storage_unavailable")
})

test("domain failures map to structured errors instead of escaping", async () => {
  const storage = memoryStorage()
  const repository = createRunRepository({ storage, ownerDirectory, now: () => 1000 })
  const missing = await repository.report(fixtureReport(), principal)
  expect(missing.ok).toBe(false)
  if (!missing.ok) expect(missing.error.code).toBe("not_found")
  await repository.report(fixtureStart(), principal)
  const staleRevision = await repository.report(fixtureReport({ operationID: "op-stale", expectedRevision: 5 }), principal)
  expect(staleRevision.ok).toBe(false)
  if (!staleRevision.ok) {
    expect(staleRevision.error.code).toBe("revision_conflict")
    expect(staleRevision.error.currentRevision).toBe(1)
  }
  const invalid = await repository.report(
    fixtureReport({ operationID: "op-invalid", operation: { type: "task.verify", taskID: "task-a", attempt: 1 } }),
    principal,
  )
  expect(invalid.ok).toBe(false)
  if (!invalid.ok) expect(invalid.error.code).toBe("invalid_transition")
  const isolated = createRunRepository({ storage: memoryStorage(), ownerDirectory, now: () => 1000 })
  const cyclic = await isolated.report(
    fixtureStart({
      operationID: "op-cyclic",
      runID: "run-cyclic",
      operation: {
        type: "run.start",
        title: "Cyclic",
        plan: fixturePlan,
        tasks: [fixtureDefinition({ id: "x", dependsOn: ["y"] }), fixtureDefinition({ id: "y", dependsOn: ["x"] })],
      },
    }),
    principal,
  )
  expect(cyclic.ok).toBe(false)
  if (!cyclic.ok) expect(cyclic.error.code).toBe("invalid_input")
})

test("oversized mutation payloads are rejected without writing", async () => {
  const storage = memoryStorage()
  const repository = createRunRepository({ storage, ownerDirectory, now: () => 1000 })
  const huge = fixtureStart({
    operationID: "op-huge",
    operation: { type: "run.start", title: "x".repeat(600_000), plan: fixturePlan, tasks: [fixtureDefinition()] },
  })
  const result = await repository.report(huge, principal)
  expect(result.ok).toBe(false)
  if (!result.ok) expect(result.error.code).toBe("limit_exceeded")
  expect(storage.writes()).toBe(0)
})

test("events cap at one thousand and record the truncation boundary", async () => {
  const storage = memoryStorage()
  const events = Array.from({ length: MAX_EVENTS }, (_, index) => ({
    revision: index + 1,
    type: "run.start" as const,
    summary: `event ${index}`,
    createdAt: index,
  }))
  storage.seed(runKey(ownerDirectory, "root", "run-1"), {
    snapshot: fixtureRun({ revision: MAX_EVENTS, events }),
    receipts: [],
  })
  const repository = createRunRepository({ storage, ownerDirectory, now: () => 5000 })
  const result = await repository.report(
    fixtureReport({ operationID: "op-next", expectedRevision: MAX_EVENTS }),
    principal,
  )
  expect(result.ok).toBe(true)
  const run = await repository.getRun("root", "run-1")
  expect(run.ok).toBe(true)
  if (!run.ok) return
  expect(run.value.revision).toBe(MAX_EVENTS + 1)
  expect(run.value.events.length).toBe(MAX_EVENTS)
  expect(run.value.events[0]?.revision).toBe(2)
  expect(run.value.historyTruncatedBeforeRevision).toBe(2)
})

test("receipts cap at 256 and drop the oldest", async () => {
  const storage = memoryStorage()
  const receipts = Array.from({ length: MAX_RECEIPTS }, (_, index) => ({
    operationID: `op-${index}`,
    payloadHash: "a".repeat(64),
    revision: index + 1,
  }))
  storage.seed(runKey(ownerDirectory, "root", "run-1"), {
    snapshot: fixtureRun({ revision: MAX_RECEIPTS }),
    receipts,
  })
  const repository = createRunRepository({ storage, ownerDirectory, now: () => 1000 })
  const result = await repository.report(
    fixtureReport({ operationID: "op-new", expectedRevision: MAX_RECEIPTS }),
    principal,
  )
  expect(result.ok).toBe(true)
  const stored = (await storage.get(runKey(ownerDirectory, "root", "run-1"))) as RunAggregate
  expect(stored.receipts.length).toBe(MAX_RECEIPTS)
  expect(stored.receipts.some((receipt) => receipt.operationID === "op-0")).toBe(false)
  expect(stored.receipts.some((receipt) => receipt.operationID === "op-new")).toBe(true)
})

test("evidence and assignments are retained up to their hard limits", async () => {
  const storage = memoryStorage()
  const repository = createRunRepository({ storage, ownerDirectory, now: () => 1000 })
  await repository.report(fixtureStart(), principal)
  let revision = 1
  for (const id of ["ass-1", "ass-2", "ass-3"]) {
    revision += 1
    const assigned = await repository.report(
      {
        operationID: `op-${id}`,
        runID: "run-1",
        expectedRevision: revision - 1,
        operation: { type: "assignment.add", id, taskID: "task-a", attempt: 1, sessionID: "child", role: "implementer" },
      },
      principal,
    )
    expect(assigned.ok).toBe(true)
  }
  for (const id of ["ev-1", "ev-2", "ev-3"]) {
    revision += 1
    const added = await repository.report(
      {
        operationID: `op-${id}`,
        runID: "run-1",
        expectedRevision: revision - 1,
        operation: {
          type: "evidence.add",
          id,
          taskID: "task-a",
          attempt: 1,
          gate: "tests",
          outcome: "passed",
          summary: "ok",
          sessionID: "child",
          messageID: `msg-${id}`,
        },
      },
      principal,
    )
    expect(added.ok).toBe(true)
  }
  const run = await repository.getRun("root", "run-1")
  expect(run.ok).toBe(true)
  if (!run.ok) return
  expect(run.value.assignments.length).toBe(3)
  expect(run.value.evidence.length).toBe(3)
})

test("an evidence count beyond the hard limit is rejected", async () => {
  const storage = memoryStorage()
  const evidence = Array.from({ length: MAX_EVIDENCE }, (_, index) => fixtureEvidence({ id: `ev-${index}` }))
  storage.seed(runKey(ownerDirectory, "root", "run-1"), {
    snapshot: fixtureRun({ revision: 1, evidence }),
    receipts: [],
  })
  const repository = createRunRepository({ storage, ownerDirectory, now: () => 1000 })
  const result = await repository.report(
    fixtureReport({
      operationID: "op-evidence",
      expectedRevision: 1,
      operation: {
        type: "evidence.add",
        id: "ev-new",
        taskID: "task-a",
        attempt: 1,
        gate: "tests",
        outcome: "passed",
        summary: "ok",
        sessionID: "child",
        messageID: "msg-new",
      },
    }),
    principal,
  )
  expect(result.ok).toBe(false)
  if (!result.ok) expect(result.error.code).toBe("limit_exceeded")
  expect(storage.writes()).toBe(0)
})

test("oversized stored records are rejected without writing", async () => {
  const storage = memoryStorage()
  const tasks = Array.from({ length: 70 }, (_, index) =>
    fixtureTask({
      id: `task-${index}`,
      dependsOn: Array.from({ length: 500 }, (_, dependency) => `dep-${index}-${dependency}`.padEnd(128, "x")),
    }),
  )
  tasks[0] = fixtureTask()
  storage.seed(runKey(ownerDirectory, "root", "run-1"), {
    snapshot: fixtureRun({ revision: 1, tasks }),
    receipts: [],
  })
  const repository = createRunRepository({ storage, ownerDirectory, now: () => 1000 })
  const result = await repository.report(
    { operationID: "op-cancel", runID: "run-1", expectedRevision: 1, operation: { type: "run.cancel", reason: "done" } },
    principal,
  )
  expect(result.ok).toBe(false)
  if (!result.ok) expect(result.error.code).toBe("limit_exceeded")
  expect(storage.writes()).toBe(0)
})

test("close waits for an accepted write and rejects new writes", async () => {
  const storage = memoryStorage()
  const repository = createRunRepository({ storage, ownerDirectory, now: () => 1000 })
  const gate = storage.pauseNextSet()
  const pending = repository.report(fixtureStart(), principal)
  await gate.started
  let closed = false
  const closing = repository.close().then(() => {
    closed = true
  })
  await Promise.resolve()
  expect(closed).toBe(false)
  const rejected = await repository.report(fixtureReport(), principal)
  expect(rejected.ok).toBe(false)
  if (!rejected.ok) expect(rejected.error.code).toBe("storage_unavailable")
  gate.release()
  const result = await pending
  expect(result.ok).toBe(true)
  await closing
  expect(closed).toBe(true)
  expect(storage.writes()).toBe(1)
})

test("a new repository reconstructs state from storage after a restart", async () => {
  const storage = memoryStorage()
  const first = createRunRepository({ storage, ownerDirectory, now: () => 1000 })
  const command = fixtureStart()
  expect((await first.report(command, principal)).ok).toBe(true)
  await first.close()
  const changes: number[] = []
  const second = createRunRepository({
    storage,
    ownerDirectory,
    now: () => 2000,
    onChanged: (event) => {
      changes.push(event.revision)
    },
  })
  const run = await second.getRun("root", "run-1")
  expect(run.ok).toBe(true)
  if (run.ok) expect(run.value.revision).toBe(1)
  const duplicate = await second.report(command, principal)
  expect(duplicate.ok).toBe(true)
  if (duplicate.ok) expect(duplicate.value.duplicate).toBe(true)
  const applied = await second.report(fixtureReport({ operationID: "op-after-restart" }), principal)
  expect(applied.ok).toBe(true)
  if (applied.ok) expect(applied.value.appliedRevision).toBe(2)
  expect(changes).toEqual([2])
  expect(storage.writes()).toBe(2)
})
