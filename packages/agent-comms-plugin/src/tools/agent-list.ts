import { tool } from "@opencode-ai/plugin"
import { buildAgentList, formatAgentList } from "../helpers"
import type { AgentConfig } from "../config"

export function createAgentListTool(
  configAgents?: Record<string, AgentConfig> | (() => Record<string, AgentConfig> | undefined),
) {
  return tool({
    description:
      "List available agent types that can be spawned or sent messages to. Returns name, mode (primary/subagent), and permission summary for each agent.",
    args: {},
    async execute() {
      const resolved = typeof configAgents === "function" ? configAgents() : configAgents
      const agents = buildAgentList(resolved)
      return formatAgentList(agents)
    },
  })
}
