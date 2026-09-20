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
