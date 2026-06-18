import { renderGoalBudget, renderGoalCleared, renderGoalPaused, renderGoalResumed } from "./renderer"
import type { GoalManager } from "./manager"

const subcommands = new Set(["status", "pause", "resume", "clear", "history", "logs", "budget"])

export async function runGoalCommand(manager: GoalManager, argumentsText: string): Promise<string> {
  const trimmed = argumentsText.trim()
  if (!trimmed || trimmed === "status") return (await manager.status()).output

  if (trimmed === "pause") return renderGoalPaused(await manager.pause())
  if (trimmed === "resume") return renderGoalResumed(await manager.resume())
  if (trimmed === "clear") return renderGoalCleared(await manager.clear())
  if (trimmed === "budget") return renderGoalBudget(await manager.enforceBudget())
  if (trimmed === "logs") return (await manager.logs()).output
  if (trimmed === "history") return (await manager.history()).output

  const [first] = trimmed.split(/\s+/, 1)
  if (first && subcommands.has(first)) return `Unknown /goal subcommand: ${trimmed}`

  const created = await manager.create(trimmed)
  return `Goal created: ${created.title}`
}
