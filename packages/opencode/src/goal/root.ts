import path from "path"
import type { InstanceContext } from "@/project/instance-context"

export interface GoalPaths {
  root: string
  goals: string
  active: string
  history: string
  activeGoal: string
  activePlan: string
  activeEvents: string
  activeEvidence: string
  activeCheckpoints: string
}

export function goalRoot(ctx: Pick<InstanceContext, "directory" | "worktree">): string {
  const root = ctx.worktree !== "/" ? ctx.worktree : ctx.directory
  return path.normalize(root)
}

export function goalPaths(ctx: Pick<InstanceContext, "directory" | "worktree">): GoalPaths {
  const root = goalRoot(ctx)
  const goals = path.join(root, ".opencode", "goals")
  const active = path.join(goals, "active")
  const history = path.join(goals, "history")

  return {
    root,
    goals,
    active,
    history,
    activeGoal: path.join(active, "goal.json"),
    activePlan: path.join(active, "plan.json"),
    activeEvents: path.join(active, "events.jsonl"),
    activeEvidence: path.join(active, "evidence.jsonl"),
    activeCheckpoints: path.join(active, "checkpoints"),
  }
}
