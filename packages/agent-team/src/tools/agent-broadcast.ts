import { tool } from "@opencode-ai/plugin/tool"
import { generateIdempotencyKey } from "../protocol/schema.js"
import type { Orchestrator } from "../orchestrator/index.js"

export function createAgentBroadcastTool(orch: Orchestrator) {
  return tool({
    description:
      "Broadcast a message to all agents in the team. Use for announcements, status updates, or general information.",
    args: {
      content: tool.schema.string().describe("Message content"),
      priority: tool.schema.enum(["critical", "high", "normal", "low"]).optional().describe("Priority level"),
    },
    async execute(args, ctx) {
      const envelope = {
        id: crypto.randomUUID(),
        type: "message" as const,
        from: ctx.agent,
        to: "broadcast" as const,
        timestamp: Date.now(),
        hop_count: 0,
        idempotency_key: generateIdempotencyKey(args.content, ctx.agent, "message"),
        priority: args.priority ?? "normal",
        protocol_version: 1,
        payload: { content: args.content },
      }
      const result = orch.router.broadcast(envelope)
      if (!result.ok) return `Error: ${result.error}`
      const count = orch.list().filter((a) => a.id !== ctx.agent && a.status !== "dead").length
      return count > 0 ? `Broadcast sent to ${count} agents` : "No other agents to broadcast to"
    },
  })
}
