import { tool } from "@opencode-ai/plugin/tool"
import type { Orchestrator } from "../orchestrator/index.js"

export function createAgentListTool(orch: Orchestrator) {
  return tool({
    description:
      "List all agents in the team with their current status, role, and capabilities. Use this to discover available agents for delegation or communication.",
    args: {
      include_details: tool.schema.boolean().optional().describe("Include capabilities and workspace info"),
    },
    async execute(args, ctx) {
      const agents = orch.list().filter((a) => a.status !== "dead")
      if (agents.length === 0) return "No agents in team"
      const lines = agents.map((a) => {
        let line = `${a.id}\t${a.role}\t${a.status}\t${a.current_task_id ?? "-"}\t$${a.cost_used.toFixed(2)}`
        if (args.include_details) {
          line += `\n  tools: ${a.capabilities.tools.join(", ")}`
          line += `\n  workspace: ${a.workspace_path}`
          line += `\n  worktrees: ${a.active_worktrees.join(", ") || "none"}`
          line += `\n  session: ${a.session_id || "none"}`
        }
        return line
      })
      return ["ID\tRole\tStatus\tTask\tCost", ...lines].join("\n")
    },
  })
}
