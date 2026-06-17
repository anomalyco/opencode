import fs from "fs/promises"
import path from "path"
import { MalformedGoalStateError, NoActiveGoalError } from "./errors"
import { goalPaths } from "./root"
import type { Goal, GoalPlan } from "./types"
import type { InstanceContext } from "@/project/instance-context"

export interface ActiveGoalState {
  goal: Goal
  plan?: GoalPlan
}

async function exists(filepath: string): Promise<boolean> {
  try {
    await fs.access(filepath)
    return true
  } catch {
    return false
  }
}

async function writeJsonAtomic(filepath: string, data: unknown): Promise<void> {
  await fs.mkdir(path.dirname(filepath), { recursive: true })
  const tmp = `${filepath}.${process.pid}.${Date.now()}.tmp`
  await fs.writeFile(tmp, JSON.stringify(data, null, 2), "utf8")
  await fs.rename(tmp, filepath)
}

function hasErrorCode(error: unknown, code: string): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === code
}

async function readJsonFile<T>(filepath: string): Promise<T> {
  try {
    return JSON.parse(await fs.readFile(filepath, "utf8"))
  } catch (error) {
    if (hasErrorCode(error, "ENOENT")) throw error
    throw new MalformedGoalStateError({ path: filepath, reason: error instanceof Error ? error.message : String(error) })
  }
}

export async function saveActiveGoal(ctx: Pick<InstanceContext, "directory" | "worktree">, state: ActiveGoalState): Promise<void> {
  const paths = goalPaths(ctx)
  await fs.mkdir(paths.activeCheckpoints, { recursive: true })
  await writeJsonAtomic(paths.activeGoal, state.goal)
  if (state.plan) await writeJsonAtomic(paths.activePlan, state.plan)
}

export async function loadActiveGoal(
  ctx: Pick<InstanceContext, "directory" | "worktree">,
): Promise<ActiveGoalState | null> {
  const paths = goalPaths(ctx)
  if (!(await exists(paths.activeGoal))) return null

  const goal = await readJsonFile<Goal>(paths.activeGoal)
  const plan = (await exists(paths.activePlan)) ? await readJsonFile<GoalPlan>(paths.activePlan) : undefined
  return { goal, plan }
}

async function moveIfExists(from: string, to: string): Promise<void> {
  if (!(await exists(from))) return
  await fs.mkdir(path.dirname(to), { recursive: true })
  await fs.rename(from, to)
}

export async function archiveActiveGoal(ctx: Pick<InstanceContext, "directory" | "worktree">): Promise<ActiveGoalState> {
  const paths = goalPaths(ctx)
  const active = await loadActiveGoal(ctx)
  if (!active) throw new NoActiveGoalError({ operation: "archive" })

  const history = path.join(paths.history, active.goal.id)
  await fs.mkdir(history, { recursive: true })

  await moveIfExists(paths.activeGoal, path.join(history, "goal.json"))
  await moveIfExists(paths.activePlan, path.join(history, "plan.json"))
  await moveIfExists(paths.activeEvents, path.join(history, "events.jsonl"))
  await moveIfExists(paths.activeEvidence, path.join(history, "evidence.jsonl"))
  await moveIfExists(paths.activeCheckpoints, path.join(history, "checkpoints"))

  try {
    await fs.rm(paths.active, { recursive: true, force: true })
  } catch {
    // best-effort cleanup; moved assets are already archived
  }

  return active
}
