import { tool } from "@opencode-ai/plugin/tool"
import { generateIdempotencyKey } from "../protocol/schema.js"
import type { Orchestrator } from "../orchestrator/index.js"

export function createAgentHandoffTool(orch: Orchestrator) {
  return tool({
    description:
      "Hand off your current task to another agent. Provide detailed progress information so the receiving agent can continue.",
    args: {
      target: tool.schema.string().describe("Agent ID to hand off to"),
      reason: tool.schema.string().describe("Why you are handing off"),
      next_steps: tool.schema.array(tool.schema.string()).describe("Next steps for the receiver"),
      transfer_worktree: tool.schema.boolean().optional().describe("Transfer your current worktree to the receiver"),
    },
    async execute(args, ctx) {
      const target = orch.getInfo(args.target)
      if (!target || target.status === "dead") return "Error: Agent not found"
      const info = orch.getInfo(ctx.agent)
      const envelope = {
        id: crypto.randomUUID(),
        type: "handoff" as const,
        from: ctx.agent,
        to: args.target,
        timestamp: Date.now(),
        hop_count: 0,
        idempotency_key: generateIdempotencyKey(args.reason, ctx.agent, "handoff"),
        priority: "high" as const,
        protocol_version: 1,
        payload: {
          task_id: info?.current_task_id ?? "",
          reason: args.reason,
          progress: {
            description: args.reason,
            files_modified: [],
            files_created: [],
            next_steps: args.next_steps,
            blockers: [],
          },
          transfer_worktree: args.transfer_worktree ?? false,
        },
      }
      const result = orch.router.route(envelope)
      if (!result.ok) return `Error: ${result.error}`
      await orch.audit.append({ agent: ctx.agent, action: "handoff", target: args.target })
      return `Task handed off to ${args.target}`
    },
  })
}
