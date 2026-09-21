import type { Assignment, Evidence, RunSnapshot, Task } from "@bearmanser/opencode-superpowers-execution/contract"
import type { ExecutionAssignment, ExecutionAgent } from "./model"
import { nativeState } from "./native-adapter"
import type { NativeRecord } from "./native-types"

export function nativeFixture(): NativeRecord[] {
  return [
    {
      id: "root",
      title: "Root controller",
      directory: "/root/git/demo",
      status: "running",
      needsInput: false,
      model: { id: "gpt-5-codex", providerID: "openai" },
    },
    {
      id: "child",
      parentID: "root",
      title: "Child implementer",
      directory: "/root/git/demo/.worktrees/feature",
      status: "running",
      needsInput: false,
    },
    {
      id: "idle-child",
      parentID: "root",
      title: "Idle reviewer",
      directory: "/root/git/demo",
      status: "idle",
      needsInput: false,
      model: { id: "claude-sonnet-4", providerID: "anthropic" },
    },
    {
      id: "grandchild",
      parentID: "child",
      title: "Grandchild worker",
      directory: "/root/git/demo/.worktrees/feature",
      status: "idle",
      needsInput: false,
    },
  ]
}

export const AGENT_FIXTURE_SCENARIOS = [
  "agents",
  "agents-missing-model",
  "agents-foreground",
  "agents-deleted",
  "agents-assignments",
  "agents-many",
] as const

export function agentFixture(scenario: string): ExecutionAgent[] {
  const base = nativeFixture().map(toAgent)
  if (scenario === "agents-foreground") {
    return base.concat(
      toAgent({
        id: "foreground",
        parentID: "root",
        title: "Foreground subagent",
        directory: "/root/git/demo",
        status: "running",
        needsInput: false,
        activity: "Editing src/api.ts",
      }),
    )
  }
  if (scenario === "agents-deleted") {
    return base.concat(
      toAgent({
        id: "deleted-child",
        parentID: "child",
        title: "Deleted child",
        directory: "/root/git/demo/.worktrees/feature",
        status: "unknown",
        needsInput: false,
        error: "Session not found",
      }),
    )
  }
  if (scenario === "agents-assignments") {
    return base.map((agent) => {
      const assignments = assignmentFixture[agent.id]
      return assignments ? { ...agent, assignments } : agent
    })
  }
  if (scenario === "agents-many") {
    const many: NativeRecord[] = [
      {
        id: "root",
        title: "Many controller",
        directory: "/root/git/demo",
        status: "running",
        needsInput: false,
        model: { id: "gpt-5-codex", providerID: "openai" },
      },
    ]
    for (let index = 1; index <= 120; index += 1) {
      const suffix = String(index).padStart(3, "0")
      many.push({
        id: `worker-${suffix}`,
        parentID: "root",
        title: `Worker ${suffix}`,
        directory: "/root/git/demo",
        status: index % 3 === 0 ? "running" : "idle",
        needsInput: false,
        error: index === 1 ? "Session not found" : undefined,
      })
    }
    return many.map(toAgent)
  }
  return base
}

const assignmentFixture: Record<string, ExecutionAssignment[]> = {
  child: [
    { id: "a1", taskID: "task-api", taskTitle: "API contract", role: "implementer", attempt: 1, active: true },
    { id: "a2", taskID: "task-verify", taskTitle: "Verification", role: "code_reviewer", attempt: 2, active: true },
    {
      id: "a3",
      taskID: "task-bootstrap",
      taskTitle: "Earlier bootstrap",
      role: "implementer",
      attempt: 1,
      active: false,
    },
  ],
}

function toAgent(record: NativeRecord): ExecutionAgent {
  return { ...record, state: nativeState(record) }
}

const FIXTURE_PLAN_HASH = "a".repeat(64)

export function taskFixture(overrides: Partial<Task> = {}): Task {
  return {
    id: "task-1",
    title: "Fixture task",
    phase: "Fixture",
    order: 0,
    dependsOn: [],
    state: "pending",
    attempt: 1,
    requiredGates: ["tests"],
    finalReview: true,
    ...overrides,
  }
}

export function failedTaskFixture(overrides: Partial<Task> = {}): Task {
  return taskFixture({
    id: "task-failed",
    title: "Failing task",
    state: "failed",
    reason: "The controller reported a failed task",
    ...overrides,
  })
}

export function runFixture(overrides: Partial<RunSnapshot> = {}): RunSnapshot {
  return {
    schemaVersion: 1,
    runID: "run-1",
    rootSessionID: "root",
    title: "Fixture run",
    ownerDirectory: "/root/git/demo",
    plan: { path: "docs/superpowers/plans/fixture.md", sha256: FIXTURE_PLAN_HASH, revision: 1 },
    revision: 1,
    status: "active",
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_000,
    tasks: [taskFixture()],
    assignments: [],
    evidence: [],
    events: [],
    ...overrides,
  }
}

const FIXTURE_EPOCH = 1_700_000_000_000

function fixtureAssignment(overrides: Partial<Assignment> & Pick<Assignment, "id" | "taskID" | "sessionID" | "role">) {
  return { attempt: 1, createdAt: FIXTURE_EPOCH, ...overrides } satisfies Assignment
}

function fixtureEvidence(
  overrides: Partial<Evidence> & Pick<Evidence, "id" | "taskID" | "gate" | "outcome" | "sessionID" | "messageID">,
) {
  return {
    attempt: 1,
    summary: "Reported gate result",
    reportedBySessionID: "root",
    createdAt: FIXTURE_EPOCH,
    ...overrides,
  } satisfies Evidence
}

export function halfVerifiedRun(): RunSnapshot {
  return runFixture({
    status: "active",
    tasks: [
      taskFixture({
        id: "task-api",
        title: "API contract",
        phase: "Build",
        order: 0,
        state: "verified",
        attempt: 1,
        requiredGates: ["tests", "code_review"],
        finalReview: false,
      }),
      taskFixture({
        id: "task-final",
        title: "Final review",
        phase: "Review",
        order: 1,
        state: "awaiting_review",
        attempt: 1,
        requiredGates: ["spec_review"],
        finalReview: true,
      }),
    ],
    assignments: [
      fixtureAssignment({ id: "a-api", taskID: "task-api", sessionID: "child", role: "implementer" }),
    ],
    evidence: [
      fixtureEvidence({
        id: "e-api-tests",
        taskID: "task-api",
        gate: "tests",
        outcome: "passed",
        sessionID: "child",
        messageID: "msg-api-1",
        partID: "part-api-1",
        summary: "Unit tests passed",
      }),
      fixtureEvidence({
        id: "e-api-review",
        taskID: "task-api",
        gate: "code_review",
        outcome: "passed",
        sessionID: "idle-child",
        messageID: "msg-api-2",
        summary: "Code review passed",
        createdAt: FIXTURE_EPOCH + 1_000,
      }),
    ],
  })
}

export function detailedTasksRun(): RunSnapshot {
  return runFixture({
    status: "active",
    tasks: [
      taskFixture({ id: "task-pending", title: "Pending work", phase: "Build", order: 0, state: "pending" }),
      taskFixture({
        id: "task-running",
        title: "Running work",
        phase: "Build",
        order: 1,
        state: "running",
        dependsOn: ["task-pending"],
      }),
      taskFixture({
        id: "task-blocked",
        title: "Blocked work",
        phase: "Build",
        order: 2,
        state: "blocked",
        dependsOn: ["task-running"],
        reason: "Waiting on a decision",
      }),
      taskFixture({ id: "task-review", title: "Awaiting review", phase: "Review", order: 3, state: "awaiting_review" }),
      taskFixture({
        id: "task-verified",
        title: "Verified work",
        phase: "Build",
        order: 4,
        state: "verified",
        requiredGates: ["tests", "code_review"],
        finalReview: false,
      }),
      taskFixture({
        id: "task-failed",
        title: "Failed work",
        phase: "Build",
        order: 5,
        state: "failed",
        attempt: 2,
        reason: "The tests gate failed on the second attempt",
      }),
      taskFixture({
        id: "task-skipped",
        title: "Skipped work",
        phase: "Legacy",
        order: 6,
        state: "skipped",
        reason: "Removed from the approved plan",
      }),
      taskFixture({
        id: "task-final",
        title: "Final review",
        phase: "Review",
        order: 7,
        state: "pending",
        requiredGates: ["spec_review"],
        finalReview: true,
      }),
    ],
    assignments: [
      fixtureAssignment({
        id: "a-inline",
        taskID: "task-verified",
        sessionID: "root",
        role: "controller",
        createdAt: FIXTURE_EPOCH - 1_000,
      }),
      fixtureAssignment({ id: "a-impl", taskID: "task-verified", sessionID: "child", role: "implementer" }),
      fixtureAssignment({
        id: "a-review",
        taskID: "task-verified",
        sessionID: "child",
        role: "code_reviewer",
        createdAt: FIXTURE_EPOCH + 2_000,
      }),
      fixtureAssignment({
        id: "a-idle",
        taskID: "task-verified",
        sessionID: "idle-child",
        role: "code_reviewer",
        createdAt: FIXTURE_EPOCH + 4_000,
        endedAt: FIXTURE_EPOCH + 5_000,
      }),
      fixtureAssignment({
        id: "a-old",
        taskID: "task-failed",
        sessionID: "child",
        role: "debugger",
        attempt: 1,
        createdAt: FIXTURE_EPOCH - 10_000,
        endedAt: FIXTURE_EPOCH - 5_000,
      }),
    ],
    evidence: [
      fixtureEvidence({
        id: "e-verified-tests",
        taskID: "task-verified",
        gate: "tests",
        outcome: "passed",
        sessionID: "child",
        messageID: "msg-v-1",
        summary: "Unit tests passed",
      }),
      fixtureEvidence({
        id: "e-verified-review",
        taskID: "task-verified",
        gate: "code_review",
        outcome: "passed",
        sessionID: "idle-child",
        messageID: "msg-v-2",
        summary: "Code review passed",
        createdAt: FIXTURE_EPOCH + 1_000,
      }),
      fixtureEvidence({
        id: "e-review-ghost",
        taskID: "task-review",
        gate: "spec_review",
        outcome: "passed",
        sessionID: "ghost",
        messageID: "msg-ghost",
        summary: "Spec review reported from a deleted session",
      }),
      fixtureEvidence({
        id: "e-failed-old",
        taskID: "task-failed",
        gate: "tests",
        outcome: "failed",
        sessionID: "child",
        messageID: "msg-f-1",
        attempt: 1,
        summary: "First attempt failed",
        createdAt: FIXTURE_EPOCH - 10_000,
      }),
      fixtureEvidence({
        id: "e-failed-new",
        taskID: "task-failed",
        gate: "tests",
        outcome: "failed",
        sessionID: "child",
        messageID: "msg-f-2",
        attempt: 2,
        summary: "Second attempt failed",
        createdAt: FIXTURE_EPOCH + 3_000,
      }),
    ],
  })
}

export function smallScopeRun(): RunSnapshot {
  return runFixture({
    revision: 1,
    status: "active",
    plan: { path: "docs/superpowers/plans/fixture.md", sha256: FIXTURE_PLAN_HASH, revision: 1 },
    tasks: [
      taskFixture({ id: "task-one", title: "First task", phase: "Build", order: 0, state: "verified" }),
      taskFixture({
        id: "task-two",
        title: "Second task",
        phase: "Build",
        order: 1,
        state: "verified",
        requiredGates: ["code_review"],
        finalReview: false,
      }),
    ],
  })
}

export function increasedScopeRun(): RunSnapshot {
  return runFixture({
    revision: 2,
    status: "active",
    plan: { path: "docs/superpowers/plans/fixture.md", sha256: FIXTURE_PLAN_HASH, revision: 2 },
    tasks: [
      taskFixture({ id: "task-one", title: "First task", phase: "Build", order: 0, state: "verified" }),
      taskFixture({
        id: "task-two",
        title: "Second task",
        phase: "Build",
        order: 1,
        state: "verified",
        requiredGates: ["code_review"],
        finalReview: false,
      }),
      taskFixture({ id: "task-three", title: "Added task", phase: "Build", order: 2, state: "pending" }),
      taskFixture({
        id: "task-four",
        title: "Added review",
        phase: "Review",
        order: 3,
        state: "pending",
        finalReview: true,
      }),
    ],
  })
}

export function taskRunFixture(scenario: string): RunSnapshot | undefined {
  if (scenario === "half-verified") return halfVerifiedRun()
  if (scenario === "tasks-detailed") return detailedTasksRun()
  if (scenario === "tasks-scope") return smallScopeRun()
  if (scenario === "tasks-stale") return halfVerifiedRun()
  return undefined
}
