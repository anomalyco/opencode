import { tool } from "@opencode-ai/plugin/tool"
import fs from "fs"
import type { Orchestrator } from "../orchestrator/index.js"

export function createAgentQueryTool(orch: Orchestrator) {
  return tool({
    description: "Query shared team memory for decisions, context, or information.",
    args: {
      query: tool.schema.string().describe("What you want to know"),
      scope: tool.schema.enum(["team", "agent"]).describe("Search scope"),
      target_agent: tool.schema.string().optional().describe("Specific agent to query (if scope is 'agent')"),
    },
    async execute(args, ctx) {
      if (args.scope === "team") {
        const memPath = `${orch.dir}/memory.jsonl`
        try {
          const content = await fs.promises.readFile(memPath, "utf-8")
          const lines = content.split("\n").filter((l) => l.trim())
          const matches = lines.filter((l) => l.toLowerCase().includes(args.query.toLowerCase()))
          if (matches.length === 0) return "No matching context found"
          return matches.slice(0, 10).join("\n")
        } catch {
          return "No matching context found"
        }
      }
      if (args.scope === "agent" && args.target_agent) {
        const info = orch.getInfo(args.target_agent)
        if (!info) return "Error: Agent not found"
        const decPath = `${info.workspace_path}/decisions.jsonl`
        try {
          const content = await fs.promises.readFile(decPath, "utf-8")
          const lines = content.split("\n").filter((l) => l.trim())
          const matches = lines.filter((l) => l.toLowerCase().includes(args.query.toLowerCase()))
          if (matches.length === 0) return "No matching context found"
          return matches.slice(0, 10).join("\n")
        } catch {
          return "No matching context found"
        }
      }
      return "No matching context found"
    },
  })
}
