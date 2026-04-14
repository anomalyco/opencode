import fs from "fs"
import type { Orchestrator } from "../orchestrator/index.js"

export function createCompactionHook(orch: Orchestrator) {
  return async (input: { sessionID: string }, output: { context: string[]; prompt?: string }): Promise<void> => {
    const agent = orch.getInfo(input.sessionID)
    const lines: string[] = []

    lines.push("## Team Memory")
    try {
      const memPath = `${orch.dir}/memory.jsonl`
      const content = await fs.promises.readFile(memPath, "utf-8")
      const recent = content
        .split("\n")
        .filter((l) => l.trim())
        .slice(-10)
      lines.push(recent.join("\n") || "No team memory yet")
    } catch {
      lines.push("No team memory yet")
    }

    if (agent) {
      lines.push("")
      lines.push("## Your Recent Decisions")
      try {
        const decPath = `${agent.workspace_path}/decisions.jsonl`
        const content = await fs.promises.readFile(decPath, "utf-8")
        const recent = content
          .split("\n")
          .filter((l) => l.trim())
          .slice(-5)
        for (const line of recent) {
          try {
            const d = JSON.parse(line)
            lines.push(`- ${d.summary}: ${d.rationale}`)
          } catch {}
        }
      } catch {
        lines.push("No recent decisions")
      }

      lines.push("")
      lines.push("## Current Task")
      if (agent.current_task_id) {
        const task = orch.taskQueue.getTaskStatus(agent.current_task_id)
        if (task) {
          lines.push(`Task: ${task.task.title}`)
          lines.push(`Status: ${task.status}`)
        }
      } else {
        lines.push("No active task")
      }
    }

    output.context.push(lines.join("\n"))
  }
}
