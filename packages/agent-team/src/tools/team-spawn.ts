import { tool } from "@opencode-ai/plugin/tool"
import type { Orchestrator } from "../orchestrator/index.js"

export function createTeamSpawnTool(orch: Orchestrator) {
  return tool({
    description:
      "Spawn a new agent in the team. The agent will be registered with the orchestrator and given an isolated workspace. Use this to add agents to the team at runtime.",
    args: {
      agent_id: tool.schema.string().optional().describe("Optional agent ID (auto-generated if omitted)"),
      role: tool.schema.string().describe("Agent role (e.g. coder, reviewer, architect, tester)"),
      tools: tool.schema
        .array(tool.schema.string())
        .optional()
        .describe("Tools this agent can use (e.g. ['read', 'edit', 'bash'])"),
      share_to_team: tool.schema.boolean().optional().describe("Whether agent can share changes to team workspace"),
      delegate: tool.schema.boolean().optional().describe("Whether agent can delegate tasks to other agents"),
      max_delegation_depth: tool.schema.number().optional().describe("Max delegation chain depth"),
      disk_quota_mb: tool.schema.number().optional().describe("Disk quota in MB"),
    },
    async execute(args) {
      try {
        const id = await orch.spawn({
          agent_id: args.agent_id,
          role: args.role,
          capabilities: {
            tools: args.tools,
            share_to_team: args.share_to_team,
            delegate: args.delegate,
            max_delegation_depth: args.max_delegation_depth,
            disk_quota_mb: args.disk_quota_mb,
          },
        })
        const info = orch.getInfo(id)
        return `Agent "${id}" spawned (role: ${info?.role}, status: ${info?.status}, workspace: ${info?.workspace_path})`
      } catch (err) {
        return `Error: ${err instanceof Error ? err.message : String(err)}`
      }
    },
  })
}
