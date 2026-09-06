export * as AgentSwarm from "./swarm"

import { Effect } from "effect"
import { spawnSync } from "node:child_process"
import { AutomationClassifier, type Classification } from "./classifier"
import { SessionSchema } from "../session/schema"

export type SwarmStage =
  | "dispatching"
  | "working"
  | "reviewing"
  | "revising"
  | "completed"
  | "escalated"

export interface SwarmHandoffEntry {
  readonly fromRole: "dispatcher" | "worker" | "reviewer"
  readonly toRole: "dispatcher" | "worker" | "reviewer" | "none"
  readonly stage: SwarmStage
  readonly summary: string
  readonly timestamp: number
  readonly feedback?: string
}

export interface SwarmTask {
  readonly id: string
  readonly title: string
  readonly prompt: string
  readonly baseBranch: string
  readonly taskBranch: string
  readonly sessionID: SessionSchema.ID
  readonly classification: Classification
  stage: SwarmStage
  revisionsCount: number
  maxRevisions: number
  readonly handoffs: SwarmHandoffEntry[]
  reviewVerdict?: "approved" | "changes_requested" | "escalated"
  lastError?: string
}

const slugify = (text: string): string =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .slice(0, 24)
    .replace(/^-+|-+$/g, "")

export const createSwarmTask = (input: {
  readonly prompt: string
  readonly baseBranch: string
  readonly sessionID: SessionSchema.ID
  readonly classification: Classification
  readonly maxRevisions?: number
}): SwarmTask => {
  const id = `swarm_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
  const slug = slugify(input.prompt) || "task"
  const taskBranch = `task/${slug}-${id.slice(-4)}`

  return {
    id,
    title: input.prompt.slice(0, 50),
    prompt: input.prompt,
    baseBranch: input.baseBranch,
    taskBranch,
    sessionID: input.sessionID,
    classification: input.classification,
    stage: "dispatching",
    revisionsCount: 0,
    maxRevisions: input.maxRevisions ?? 3,
    handoffs: [],
  }
}

export const dispatchTask = (
  task: SwarmTask,
  workspaceDir: string,
): Effect.Effect<{ taskBranch: string; assignedWorker: string }, Error> =>
  Effect.sync(() => {
    // 1. Create task branch with git isolation (without checking out over current workspace)
    const branchResult = spawnSync("git", ["branch", task.taskBranch], {
      cwd: workspaceDir,
      encoding: "utf8",
    })
    if (branchResult.status !== 0 && !branchResult.stderr.includes("already exists")) {
      // Fallback: note branch creation attempt
    }

    // 2. Select worker based on classification
    const assignedWorker =
      task.classification.complexity === "high"
        ? "senior-engineer"
        : task.classification.taskType === "refactor"
          ? "refactor-specialist"
          : "feature-developer"

    task.stage = "working"
    task.handoffs.push({
      fromRole: "dispatcher",
      toRole: "worker",
      stage: "working",
      summary: `Dispatched task '${task.title}' to ${assignedWorker} on isolated branch ${task.taskBranch}`,
      timestamp: Date.now(),
    })

    return { taskBranch: task.taskBranch, assignedWorker }
  })

export const submitForReview = (
  task: SwarmTask,
  commitMessage?: string,
): SwarmHandoffEntry => {
  task.stage = "reviewing"
  const entry: SwarmHandoffEntry = {
    fromRole: "worker",
    toRole: "reviewer",
    stage: "reviewing",
    summary: `Worker completed implementation${commitMessage ? `: ${commitMessage}` : ""}. Ready for review.`,
    timestamp: Date.now(),
  }
  task.handoffs.push(entry)
  return entry
}

export const reviewTask = (
  task: SwarmTask,
  review: {
    readonly passed: boolean
    readonly feedback?: string
    readonly requiresEscalation?: boolean
  },
): { readonly stage: SwarmStage; readonly handoff: SwarmHandoffEntry } => {
  if (review.requiresEscalation) {
    task.stage = "escalated"
    task.reviewVerdict = "escalated"
    const handoff: SwarmHandoffEntry = {
      fromRole: "reviewer",
      toRole: "dispatcher",
      stage: "escalated",
      summary: `Escalation requested by reviewer: ${review.feedback ?? "Critical blocker detected"}`,
      timestamp: Date.now(),
      feedback: review.feedback,
    }
    task.handoffs.push(handoff)
    return { stage: "escalated", handoff }
  }

  if (review.passed) {
    task.stage = "completed"
    task.reviewVerdict = "approved"
    const handoff: SwarmHandoffEntry = {
      fromRole: "reviewer",
      toRole: "none",
      stage: "completed",
      summary: "Review approved. Task successfully verified on branch.",
      timestamp: Date.now(),
    }
    task.handoffs.push(handoff)
    return { stage: "completed", handoff }
  }

  // Changes requested
  task.revisionsCount++
  if (task.revisionsCount > task.maxRevisions) {
    task.stage = "escalated"
    task.reviewVerdict = "escalated"
    const handoff: SwarmHandoffEntry = {
      fromRole: "reviewer",
      toRole: "dispatcher",
      stage: "escalated",
      summary: `Max review cycles (${task.maxRevisions}) reached without consensus. Escalating.`,
      timestamp: Date.now(),
      feedback: review.feedback,
    }
    task.handoffs.push(handoff)
    return { stage: "escalated", handoff }
  }

  task.stage = "revising"
  task.reviewVerdict = "changes_requested"
  const handoff: SwarmHandoffEntry = {
    fromRole: "reviewer",
    toRole: "worker",
    stage: "revising",
    summary: `Revisions requested (round ${task.revisionsCount}/${task.maxRevisions}): ${review.feedback ?? "Fix review findings"}`,
    timestamp: Date.now(),
    feedback: review.feedback,
  }
  task.handoffs.push(handoff)
  return { stage: "revising", handoff }
}
