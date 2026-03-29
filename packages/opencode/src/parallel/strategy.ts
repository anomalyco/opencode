import z from "zod"
import { buildWaves } from "./scheduler"
import type { Plan, ExecutionMode } from "./schema"
import type { Project } from "@/project/project"

export const StrategyMode = z.enum(["single-agent", "task-agent", "worktree"])
export type StrategyMode = z.infer<typeof StrategyMode>

export const StrategyConfidence = z.enum(["high", "medium", "low"])
export type StrategyConfidence = z.infer<typeof StrategyConfidence>

export const StrategyAnalysis = z.object({
  recommended: StrategyMode,
  confidence: StrategyConfidence,
  requiresConfirmation: z.boolean(),
  reasons: z.array(z.string()),
  risks: z.array(z.string()),
  alternatives: z.array(StrategyMode),
})
export type StrategyAnalysis = z.infer<typeof StrategyAnalysis>

function uniq(input: string[]) {
  return [...new Set(input.filter(Boolean))]
}

function alternatives(mode: StrategyMode) {
  return (["worktree", "task-agent", "single-agent"] as const).filter((item) => item !== mode)
}

export function analyzeStrategy(plan: Pick<Plan, "task" | "subtasks" | "workers">, project?: Project.Info): StrategyAnalysis {
  const waves = buildWaves(plan.subtasks)
  const total = plan.subtasks.length
  const overlap = waves.overlaps.length
  const structural = total > 0 && plan.subtasks.every((item) => item.kind === "structural")
  const git = project?.vcs === "git" && project.worktree !== "/"
  const reasons: string[] = []
  const risks: string[] = []

  if (!git) {
    reasons.push("Project is not a verified git repository, so isolated worktrees are unsafe.")
    risks.push("Parallel worktree execution can target the wrong filesystem root without verified git identity.")
    return {
      recommended: "task-agent",
      confidence: "high",
      requiresConfirmation: true,
      reasons,
      risks,
      alternatives: alternatives("task-agent"),
    }
  }

  if (total <= 1) {
    reasons.push("The plan only contains one subtask, so parallel orchestration adds overhead without isolation value.")
    return {
      recommended: "single-agent",
      confidence: "high",
      requiresConfirmation: false,
      reasons,
      risks,
      alternatives: alternatives("single-agent"),
    }
  }

  if (structural && total <= 2 && overlap === 0) {
    reasons.push("This looks like a small structural refactor that should stay in one editing context.")
    risks.push("Splitting small mechanical refactors across workers adds review and merge overhead.")
    return {
      recommended: "single-agent",
      confidence: "medium",
      requiresConfirmation: false,
      reasons,
      risks,
      alternatives: alternatives("single-agent"),
    }
  }

  if (waves.serialCount > waves.parallelizableCount || (overlap > 0 && waves.parallelizableCount <= 2)) {
    reasons.push("The dependency and file-scope graph is mostly serial, so worktree isolation offers limited benefit.")
    risks.push("Workers are likely to wait on each other or converge on shared files.")
    return {
      recommended: "task-agent",
      confidence: "medium",
      requiresConfirmation: true,
      reasons: uniq(reasons),
      risks: uniq(risks),
      alternatives: alternatives("task-agent"),
    }
  }

  reasons.push("Git worktree isolation is available and the plan has enough independent subtasks to justify parallel branches.")
  if (overlap > 0) {
    reasons.push("The scheduler can serialize the overlapping scopes into waves.")
    risks.push(`The plan still has ${overlap} overlapping file-scope pair${overlap === 1 ? "" : "s"}.`)
  }

  return {
    recommended: "worktree",
    confidence: overlap === 0 ? "high" : "medium",
    requiresConfirmation: true,
    reasons: uniq(reasons),
    risks: uniq(risks),
    alternatives: alternatives("worktree"),
  }
}

export function selectExecutionMode(
  plan: Pick<Plan, "task" | "subtasks" | "workers" | "executionMode">,
  project?: Project.Info,
): ExecutionMode {
  if (plan.executionMode) return plan.executionMode
  return analyzeStrategy(plan, project).recommended === "worktree" ? "worktree" : "task-agent"
}
