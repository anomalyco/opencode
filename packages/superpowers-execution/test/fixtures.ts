import type { StorageScanOptions, StorageScanResult, StorageValue } from "../src/repository"
import type { Evidence, ReportCommand, RunSnapshot, Task, TaskDefinition } from "../src/schema"

const plan = { path: "docs/plan.md", sha256: "0".repeat(64) }

export const fixturePlan = plan

const definition: TaskDefinition = {
  id: "task-a",
  title: "Task A",
  phase: "Phase 1",
  order: 0,
  dependsOn: [],
  requiredGates: ["tests"],
  finalReview: false,
}

export function fixtureTask(overrides: Partial<Task> = {}): Task {
  return {
    id: "task-a",
    title: "Task A",
    phase: "Phase 1",
    order: 0,
    dependsOn: [],
    state: "pending",
    attempt: 1,
    requiredGates: ["tests"],
    finalReview: false,
    ...overrides,
  }
}

export function fixtureRun(overrides: Partial<RunSnapshot> = {}): RunSnapshot {
  return {
    schemaVersion: 1,
    runID: "run-1",
    rootSessionID: "root",
    title: "Execution run",
    ownerDirectory: "/root/git/demo",
    plan: { ...plan, revision: 1 },
    revision: 1,
    status: "active",
    createdAt: 1_000,
    updatedAt: 1_000,
    tasks: [fixtureTask()],
    assignments: [],
    evidence: [],
    events: [],
    ...overrides,
  }
}

export function fixtureStart(overrides: Partial<ReportCommand> = {}): ReportCommand {
  return {
    operationID: "op-start",
    runID: "run-1",
    expectedRevision: 0,
    operation: { type: "run.start", title: "Execution run", plan, tasks: [definition] },
    ...overrides,
  }
}

export function fixtureReport(overrides: Partial<ReportCommand> = {}): ReportCommand {
  return {
    operationID: "op-report",
    runID: "run-1",
    expectedRevision: 1,
    operation: { type: "task.state", taskID: "task-a", attempt: 1, state: "running" },
    ...overrides,
  }
}

export function fixtureDefinition(overrides: Partial<TaskDefinition> = {}): TaskDefinition {
  return { ...definition, ...overrides }
}

export function fixtureDefinitions(): TaskDefinition[] {
  return [
    fixtureDefinition({ id: "spec", title: "Spec", phase: "Phase 1", order: 0, dependsOn: [] }),
    fixtureDefinition({ id: "impl", title: "Implement", phase: "Phase 1", order: 1, dependsOn: ["spec"] }),
    fixtureDefinition({
      id: "review",
      title: "Final review",
      phase: "Phase 2",
      order: 2,
      dependsOn: ["impl"],
      requiredGates: ["spec_review", "code_review"],
      finalReview: true,
    }),
    fixtureDefinition({ id: "docs", title: "Docs", phase: "Phase 1", order: 3, dependsOn: [] }),
  ]
}

export function fixtureEvidence(overrides: Partial<Evidence> = {}): Evidence {
  return {
    id: "ev-1",
    taskID: "task-a",
    attempt: 1,
    gate: "tests",
    outcome: "passed",
    summary: "tests passed",
    sessionID: "child",
    messageID: "msg-1",
    reportedBySessionID: "root",
    createdAt: 2,
    ...overrides,
  }
}

export function fixtureComplete(overrides: Partial<RunSnapshot> = {}): RunSnapshot {
  return fixtureRun({
    plan: { ...plan, revision: 2 },
    revision: 3,
    status: "completed",
    tasks: [
      fixtureTask({ id: "spec", title: "Spec", state: "verified" }),
      fixtureTask({ id: "impl", title: "Implement", order: 1, dependsOn: ["spec"], state: "verified" }),
      fixtureTask({
        id: "review",
        title: "Final review",
        order: 2,
        dependsOn: ["impl"],
        state: "verified",
        finalReview: true,
        requiredGates: ["spec_review", "code_review"],
      }),
    ],
    evidence: [
      fixtureEvidence({ id: "ev-spec", taskID: "spec" }),
      fixtureEvidence({ id: "ev-impl", taskID: "impl" }),
      fixtureEvidence({ id: "ev-review-spec", taskID: "review", gate: "spec_review" }),
      fixtureEvidence({ id: "ev-review-code", taskID: "review", gate: "code_review" }),
    ],
    ...overrides,
  })
}

export function fixtureFailure(overrides: Partial<RunSnapshot> = {}): RunSnapshot {
  return fixtureRun({
    revision: 3,
    tasks: [
      fixtureTask({ id: "spec", title: "Spec", state: "verified" }),
      fixtureTask({ id: "impl", title: "Implement", order: 1, dependsOn: ["spec"], state: "failed", reason: "suite red" }),
    ],
    evidence: [fixtureEvidence({ id: "ev-spec", taskID: "spec" })],
    ...overrides,
  })
}

export function fixtureReopened(overrides: Partial<RunSnapshot> = {}): RunSnapshot {
  return fixtureRun({
    revision: 4,
    tasks: [
      fixtureTask({ id: "spec", title: "Spec", state: "pending", attempt: 2 }),
      fixtureTask({ id: "impl", title: "Implement", order: 1, dependsOn: ["spec"], state: "pending", attempt: 2 }),
    ],
    evidence: [fixtureEvidence({ id: "ev-spec", taskID: "spec" })],
    ...overrides,
  })
}

export function fixtureScopeChange(overrides: Partial<RunSnapshot> = {}): RunSnapshot {
  return fixtureRun({
    plan: { ...plan, revision: 2 },
    revision: 4,
    tasks: [
      fixtureTask({ id: "spec", title: "Spec", state: "verified" }),
      fixtureTask({ id: "impl", title: "Implement", order: 1, dependsOn: [], state: "pending", attempt: 2 }),
      fixtureTask({ id: "docs", title: "Docs", order: 3, dependsOn: [], state: "skipped", reason: "Dropped from scope" }),
    ],
    evidence: [fixtureEvidence({ id: "ev-spec", taskID: "spec" })],
    ...overrides,
  })
}

export interface MemoryStorage {
  get(key: string): Promise<StorageValue | undefined>
  set(key: string, value: StorageValue): Promise<void>
  remove(key: string): Promise<void>
  scan(options: StorageScanOptions): Promise<StorageScanResult>
  writes(): number
  seed(key: string, value: StorageValue): void
  failNextSet(options?: { afterWrite?: boolean }): void
  failNextGet(): void
  failNextScan(): void
  pauseNextSet(): { started: Promise<void>; release: () => void }
}

export function memoryStorage(): MemoryStorage {
  const values = new Map<string, StorageValue>()
  let writeCount = 0
  let failSet: { afterWrite: boolean } | undefined
  let failGet = false
  let failScan = false
  let pause: { started: Promise<void>; released: Promise<void>; start: () => void; release: () => void } | undefined

  return {
    async get(key) {
      if (failGet) {
        failGet = false
        throw new Error("storage get failed")
      }
      const value = values.get(key)
      return value === undefined ? undefined : structuredClone(value)
    },
    async set(key, value) {
      const fault = failSet
      failSet = undefined
      if (fault !== undefined) {
        if (fault.afterWrite) {
          values.set(key, structuredClone(value))
          writeCount += 1
        }
        throw new Error("storage set failed")
      }
      const gate = pause
      if (gate !== undefined) {
        pause = undefined
        gate.start()
        await gate.released
      }
      values.set(key, structuredClone(value))
      writeCount += 1
    },
    async remove(key) {
      values.delete(key)
    },
    async scan(options) {
      if (failScan) {
        failScan = false
        throw new Error("storage scan failed")
      }
      const prefixMatches = [...values.keys()].filter((key) => key.startsWith(options.prefix)).sort()
      const after = options.after
      const remaining = after === undefined ? prefixMatches : prefixMatches.filter((key) => key > after)
      const page = options.limit === undefined ? remaining : remaining.slice(0, options.limit)
      return {
        entries: page.map((key) => ({ key, value: structuredClone(values.get(key)!) })),
        ...(page.length < remaining.length ? { next: page[page.length - 1] } : {}),
      }
    },
    writes: () => writeCount,
    seed(key, value) {
      values.set(key, structuredClone(value))
    },
    failNextSet(options) {
      failSet = { afterWrite: options?.afterWrite ?? false }
    },
    failNextGet() {
      failGet = true
    },
    failNextScan() {
      failScan = true
    },
    pauseNextSet() {
      const started = Promise.withResolvers<void>()
      const released = Promise.withResolvers<void>()
      pause = { started: started.promise, released: released.promise, start: started.resolve, release: released.resolve }
      return { started: started.promise, release: released.resolve }
    },
  }
}
