import fs from "fs/promises"
import path from "path"
import { goalPaths } from "./root"
import type { Goal, GoalCheckpoint, GoalPlan } from "./types"
import type { InstanceContext } from "@/project/instance-context"

export interface CreateGoalCheckpointInput {
  id: string
  goal: Goal
  plan?: GoalPlan
  createdAt?: string
}

function checkpointFilename(id: string): string {
  return `${id}.json`
}

export async function createGoalCheckpoint(
  ctx: Pick<InstanceContext, "directory" | "worktree">,
  input: CreateGoalCheckpointInput,
): Promise<GoalCheckpoint> {
  const paths = goalPaths(ctx)
  const checkpoint: GoalCheckpoint = {
    id: input.id,
    goalId: input.goal.id,
    state: input.goal.state,
    currentStepId: input.goal.currentStepId,
    goalSnapshot: input.goal,
    planSnapshot: input.plan,
    createdAt: input.createdAt ?? new Date().toISOString(),
  }

  await fs.mkdir(paths.activeCheckpoints, { recursive: true })
  await fs.writeFile(path.join(paths.activeCheckpoints, checkpointFilename(input.id)), JSON.stringify(checkpoint, null, 2), "utf8")
  return checkpoint
}

function hasErrorCode(error: unknown, code: string): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === code
}

export async function listGoalCheckpoints(
  ctx: Pick<InstanceContext, "directory" | "worktree">,
): Promise<GoalCheckpoint[]> {
  const paths = goalPaths(ctx)
  let entries: string[]
  try {
    entries = await fs.readdir(paths.activeCheckpoints)
  } catch (error) {
    if (hasErrorCode(error, "ENOENT")) return []
    throw error
  }

  const checkpoints: GoalCheckpoint[] = []
  for (const entry of entries.filter((item) => item.endsWith(".json")).sort()) {
    checkpoints.push(JSON.parse(await fs.readFile(path.join(paths.activeCheckpoints, entry), "utf8")))
  }
  return checkpoints
}
