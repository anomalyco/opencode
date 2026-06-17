import fs from "fs/promises"
import path from "path"
import { goalPaths } from "./root"
import type { GoalEvent } from "./types"
import type { InstanceContext } from "@/project/instance-context"

export async function appendGoalEvent(
  ctx: Pick<InstanceContext, "directory" | "worktree">,
  event: GoalEvent,
): Promise<void> {
  const paths = goalPaths(ctx)
  await fs.mkdir(path.dirname(paths.activeEvents), { recursive: true })
  await fs.appendFile(paths.activeEvents, JSON.stringify(event) + "\n", "utf8")
}

function hasErrorCode(error: unknown, code: string): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === code
}

export async function readGoalEvents(ctx: Pick<InstanceContext, "directory" | "worktree">): Promise<GoalEvent[]> {
  const paths = goalPaths(ctx)
  let text: string
  try {
    text = await fs.readFile(paths.activeEvents, "utf8")
  } catch (error) {
    if (hasErrorCode(error, "ENOENT")) return []
    throw error
  }

  const events: GoalEvent[] = []
  for (const line of text.split("\n")) {
    if (!line.trim()) continue
    try {
      events.push(JSON.parse(line))
    } catch {
      continue
    }
  }
  return events
}
