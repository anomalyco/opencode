import type { Assignment, Evidence, RunEvent, RunSnapshot, Task } from "@bearmanser/opencode-superpowers-execution/contract"
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
  "agents-telemetry",
] as const

export function agentFixture(scenario: string): ExecutionAgent[] {
  if (scenario === "agents-telemetry") return usageAgents().map(toAgent)
  if (scenario === "activity") return fullUsageAgents().map(toAgent)
  if (scenario === "agents-telemetry-partial") {
    return usageAgents()
      .concat([
        {
          id: "deleted-child",
          parentID: "child",
          title: "Deleted child",
          directory: "/root/git/demo/.worktrees/feature",
          status: "unknown",
          needsInput: false,
          error: "Session not found",
        },
      ])
      .map(toAgent)
  }
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

const FIXTURE_TOKENS = (input: number, output: number, read = 0) => ({
  input,
  output,
  reasoning: 0,
  cache: { read, write: 0 },
})

function usageAgents(): NativeRecord[] {
  return nativeFixture().map((record) => {
    if (record.id === "root") return { ...record, usage: { cost: 1.5, tokens: FIXTURE_TOKENS(1000, 250, 500) } }
    if (record.id === "child") return { ...record, usage: { cost: 0.5, tokens: FIXTURE_TOKENS(500, 100) } }
    return record
  })
}

function fullUsageAgents(): NativeRecord[] {
  return usageAgents().map((record) => {
    if (record.id === "idle-child") return { ...record, usage: { cost: 0.25, tokens: FIXTURE_TOKENS(50, 0) } }
    if (record.id === "grandchild") return { ...record, usage: { cost: 0.25, tokens: FIXTURE_TOKENS(25, 0) } }
    return record
  })
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
        id: "e-review-missing",
        taskID: "task-review",
        gate: "spec_review",
        outcome: "passed",
        sessionID: "idle-child",
        messageID: "msg-missing",
        summary: "Spec review reported from an unloaded native message",
        createdAt: FIXTURE_EPOCH + 500,
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

export function gateOrderRun(): RunSnapshot {
  return runFixture({
    status: "active",
    tasks: [
      taskFixture({
        id: "task-gate",
        title: "Gate order",
        phase: "Build",
        order: 0,
        state: "awaiting_review",
        requiredGates: ["tests"],
        finalReview: false,
      }),
    ],
    evidence: [
      fixtureEvidence({
        id: "z-pass",
        taskID: "task-gate",
        gate: "tests",
        outcome: "passed",
        sessionID: "child",
        messageID: "msg-gate-1",
        summary: "Earlier pass appended first",
      }),
      fixtureEvidence({
        id: "a-fail",
        taskID: "task-gate",
        gate: "tests",
        outcome: "failed",
        sessionID: "child",
        messageID: "msg-gate-2",
        summary: "Later failure appended second",
      }),
    ],
  })
}

export function taskGraphFixture(): Task[] {
  return [
    taskFixture({
      id: "schema",
      title: "Implement storage schema",
      phase: "Implementation",
      order: 0,
      dependsOn: [],
      state: "verified",
      requiredGates: ["tests"],
      finalReview: false,
    }),
    taskFixture({
      id: "api",
      title: "Implement RPC tools",
      phase: "Implementation",
      order: 1,
      dependsOn: ["schema"],
      state: "awaiting_review",
      requiredGates: ["tests", "code_review"],
      finalReview: false,
    }),
    taskFixture({
      id: "cli",
      title: "Wire the command-line interface, its generated client surface, and adapters",
      phase: "Implementation",
      order: 2,
      dependsOn: ["schema"],
      state: "running",
      requiredGates: ["tests"],
      finalReview: false,
    }),
    taskFixture({
      id: "tests",
      title: "Run the full suite",
      phase: "Verification",
      order: 3,
      dependsOn: ["api", "cli"],
      state: "pending",
      requiredGates: ["tests"],
      finalReview: false,
    }),
    taskFixture({
      id: "final-review",
      title: "Review the whole branch",
      phase: "Review",
      order: 4,
      dependsOn: ["tests"],
      state: "pending",
      requiredGates: ["code_review"],
      finalReview: true,
    }),
  ]
}

export function taskGraphRun(): RunSnapshot {
  return runFixture({
    tasks: taskGraphFixture(),
    assignments: [
      fixtureAssignment({ id: "g-schema", taskID: "schema", sessionID: "child", role: "implementer" }),
      fixtureAssignment({ id: "g-api-impl", taskID: "api", sessionID: "child", role: "implementer" }),
      fixtureAssignment({ id: "g-api-review", taskID: "api", sessionID: "idle-child", role: "code_reviewer" }),
    ],
  })
}

export function largeGraphRun(): RunSnapshot {
  const tasks = Array.from({ length: 250 }, (_, index) =>
    taskFixture({
      id: `task-${String(index).padStart(3, "0")}`,
      title: `Task ${String(index).padStart(3, "0")}`,
      phase: index % 2 === 0 ? "Build" : "Verify",
      order: index,
    }),
  )
  return runFixture({ tasks })
}

export function trackedRun(): RunSnapshot {
  return runFixture({
    runID: "run-tracked",
    revision: 4,
    status: "active",
    plan: { path: "docs/superpowers/plans/tracked.md", sha256: FIXTURE_PLAN_HASH, revision: 2 },
    tasks: [
      taskFixture({ id: "api", title: "API contract", phase: "Build", order: 0, state: "running", attempt: 1 }),
      taskFixture({
        id: "schema",
        title: "Storage schema",
        phase: "Build",
        order: 1,
        state: "verified",
        requiredGates: ["tests"],
        finalReview: false,
      }),
      taskFixture({
        id: "final-review",
        title: "Final review",
        phase: "Review",
        order: 2,
        state: "awaiting_review",
        requiredGates: ["spec_review"],
        finalReview: true,
      }),
    ],
    assignments: [fixtureAssignment({ id: "a-tracked-api", taskID: "api", sessionID: "child", role: "implementer" })],
  })
}

export function taskRunFixture(scenario: string): RunSnapshot | undefined {
  if (scenario === "tracked" || scenario === "tracked-rtl") return trackedRun()
  if (scenario === "half-verified") return halfVerifiedRun()
  if (scenario === "tasks-detailed") return detailedTasksRun()
  if (scenario === "tasks-scope") return smallScopeRun()
  if (scenario === "tasks-stale") return halfVerifiedRun()
  if (scenario === "tasks-gate-order") return gateOrderRun()
  if (scenario === "map") return taskGraphRun()
  if (scenario === "map-large") return largeGraphRun()
  if (scenario === "activity") return activityRun()
  if (scenario === "activity-empty") return runFixture({ runID: "run-activity-empty" })
  return undefined
}

const ACTIVITY_EPOCH = 1_700_001_000_000

export function activityRun(): RunSnapshot {
  const filler: RunEvent[] = Array.from({ length: 146 }, (_, index) => ({
    revision: 1001 + index,
    type: index % 3 === 0 ? "task.state" : index % 2 === 0 ? "evidence.add" : "assignment.add",
    taskID: index % 5 === 0 ? "task-review" : "task-api",
    summary: `Reported event ${1001 + index}`,
    createdAt: ACTIVITY_EPOCH + index * 1_000,
  }))
  const tail: RunEvent[] = [
    {
      revision: 1147,
      type: "assignment.add",
      taskID: "task-review",
      summary: "code_reviewer assigned to task-review",
      createdAt: ACTIVITY_EPOCH + 146_000,
    },
    {
      revision: 1148,
      type: "evidence.add",
      taskID: "task-review",
      summary: "spec_review passed for task-review",
      createdAt: ACTIVITY_EPOCH + 147_000,
    },
    {
      revision: 1149,
      type: "evidence.add",
      taskID: "task-api",
      summary: "tests passed for task-api",
      createdAt: ACTIVITY_EPOCH + 148_000,
    },
    {
      revision: 1150,
      type: "assignment.add",
      taskID: "task-api",
      summary: "implementer assigned to task-api",
      createdAt: ACTIVITY_EPOCH + 149_000,
    },
  ]
  return runFixture({
    runID: "run-activity",
    revision: 1150,
    updatedAt: ACTIVITY_EPOCH + 149_000,
    status: "active",
    tasks: [
      taskFixture({ id: "task-api", title: "API contract", phase: "Build", order: 0, state: "verified" }),
      taskFixture({
        id: "task-review",
        title: "Final review",
        phase: "Review",
        order: 1,
        state: "awaiting_review",
        requiredGates: ["spec_review"],
        finalReview: true,
      }),
    ],
    assignments: [
      fixtureAssignment({
        id: "a-activity-api",
        taskID: "task-api",
        sessionID: "child",
        role: "implementer",
        createdAt: ACTIVITY_EPOCH + 149_000,
      }),
      fixtureAssignment({
        id: "a-activity-review",
        taskID: "task-review",
        sessionID: "idle-child",
        role: "code_reviewer",
        createdAt: ACTIVITY_EPOCH + 146_000,
      }),
    ],
    evidence: [
      fixtureEvidence({
        id: "e-activity-api",
        taskID: "task-api",
        gate: "tests",
        outcome: "passed",
        sessionID: "child",
        messageID: "msg-activity-1",
        summary: "Tests passed",
        createdAt: ACTIVITY_EPOCH + 148_000,
      }),
      fixtureEvidence({
        id: "e-activity-review",
        taskID: "task-review",
        gate: "spec_review",
        outcome: "passed",
        sessionID: "idle-child",
        messageID: "msg-activity-2",
        summary: "Spec review passed",
        createdAt: ACTIVITY_EPOCH + 147_000,
      }),
    ],
    events: [...filler, ...tail],
    historyTruncatedBeforeRevision: 1001,
  })
}
