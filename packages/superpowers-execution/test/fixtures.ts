import type { ReportCommand, RunSnapshot, Task, TaskDefinition } from "../src/schema"

const plan = { path: "docs/plan.md", sha256: "0".repeat(64) }

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
