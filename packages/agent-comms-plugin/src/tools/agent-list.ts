import { tool } from "@opencode-ai/plugin"
import { buildAgentList, formatAgentList } from "../helpers"
import type { AgentConfig } from "../config"

type Deps = {
  configAgents?: Record<string, AgentConfig> | (() => Record<string, AgentConfig> | undefined)
  client: any
}

export function createAgentListTool(deps: Deps) {
  return tool({
    description:
      "List available agent types that can be spawned or sent messages to. Returns name, mode (primary/subagent), and permission summary for each agent. Optionally specify a directory to list agents from a different project.",
    args: {
      directory: tool.schema
        .string()
        .optional()
        .describe("Project directory to list agents from. Defaults to the current project directory."),
    },
    async execute(args, ctx) {
      const dir = args.directory || ctx.directory

      if (dir !== ctx.directory && deps.client?.app?.agents) {
        try {
          const res = await deps.client.app.agents({ query: { directory: dir } })
          const agents = res.data ?? []
          if (!Array.isArray(agents) || agents.length === 0) return "No agents found."
          const lines = agents.map((a: any) => {
            const mode = a.mode ?? "unknown"
            const builtin = a.builtIn ? " (built-in)" : ""
            const desc = a.description ? ` — ${a.description}` : ""
            const tools = a.tools ? Object.keys(a.tools).filter((k: string) => a.tools[k]) : []
            const perm = a.permission ?? {}
            const editPerm = perm.edit ?? "unknown"
            const bashPerms = perm.bash ? Object.entries(perm.bash).map(([k, v]) => `${k}:${v}`) : []
            let line = `- ${a.name} (${mode}${builtin})${desc}`
            if (tools.length) line += `\n  Tools: ${tools.join(", ")}`
            line += `\n  Permissions: edit=${editPerm}`
            if (bashPerms.length) line += `, bash={${bashPerms.join(", ")}}`
            return line
          })
          return `Found ${agents.length} agent(s) in ${dir}:\n${lines.join("\n")}`
        } catch (err: any) {
          return `Error listing agents from ${dir}: ${err.message}`
        }
      }

      const resolved = typeof deps.configAgents === "function" ? deps.configAgents() : deps.configAgents
      const agents = buildAgentList(resolved)
      return formatAgentList(agents)
    },
  })
}
