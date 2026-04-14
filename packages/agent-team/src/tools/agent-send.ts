import { tool } from "@opencode-ai/plugin/tool"
import { generateIdempotencyKey } from "../protocol/schema.js"
import type { Orchestrator } from "../orchestrator/index.js"

export function createAgentSendTool(orch: Orchestrator) {
  return tool({
    description:
      "Send a message to another agent in the team. Use this to communicate findings, ask questions, or share information.",
    args: {
      target: tool.schema.string().describe("Agent ID to send to"),
      content: tool.schema.string().describe("Message content"),
      type: tool.schema.enum(["message", "question", "notification"]).describe("Message type"),
      priority: tool.schema.enum(["critical", "high", "normal", "low"]).optional().describe("Priority level"),
      correlation_id: tool.schema.string().optional().describe("For reply chains"),
    },
    async execute(args, ctx) {
      if (args.target === ctx.agent) return "Error: Cannot send to yourself"
      const target = orch.getInfo(args.target)
      if (!target || target.status === "dead") return "Error: Agent not found"
      const envelope = {
        id: crypto.randomUUID(),
        type: "message" as const,
        from: ctx.agent,
        to: args.target,
        timestamp: Date.now(),
        hop_count: 0,
        idempotency_key: generateIdempotencyKey(args.content, ctx.agent, "message"),
        priority: args.priority ?? "normal",
        protocol_version: 1,
        correlation_id: args.correlation_id,
        payload: { content: args.content },
      }
      const result = orch.router.route(envelope)
      if (!result.ok) return `Error: ${result.error}`

      if (target.session_id && target.status === "idle") {
        try {
          await orch.sendToAgent(args.target, `[Message from ${ctx.agent}]: ${args.content}`)
        } catch {}
      }

      return `Message sent to ${args.target}`
    },
  })
}
