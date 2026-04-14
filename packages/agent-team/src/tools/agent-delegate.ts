import { tool } from "@opencode-ai/plugin/tool"
import type { Orchestrator } from "../orchestrator/index.js"

export function createAgentDelegateTool(orch: Orchestrator) {
  return tool({
    description:
      "Delegate a task to another agent and wait for the result. Choose an agent whose capabilities match the task requirements.",
    args: {
      target: tool.schema.string().describe("Agent ID to delegate to"),
      title: tool.schema.string().describe("Short task title"),
      description: tool.schema.string().describe("Detailed task description"),
      priority: tool.schema.enum(["critical", "high", "normal", "low"]).optional().describe("Priority"),
      required_capabilities: tool.schema.array(tool.schema.string()).optional().describe("Required capabilities"),
      deadline_seconds: tool.schema.number().optional().describe("Task deadline in seconds"),
      files: tool.schema.array(tool.schema.string()).optional().describe("Relevant file paths"),
      context: tool.schema.string().optional().describe("Additional context"),
    },
    async execute(args) {
      const target = orch.getInfo(args.target)
      if (!target || target.status === "dead") return "Error: Agent not found"
      if (args.required_capabilities?.length) {
        const hasAll = args.required_capabilities.every((c) => target.capabilities.tools.includes(c))
        if (!hasAll) return "Error: Agent lacks required capabilities"
      }
      if (target.status === "busy") return `Error: Agent ${args.target} is busy with task ${target.current_task_id}`

      const taskId = crypto.randomUUID()
      orch.registry.updateStatus(args.target, "busy", taskId)

      try {
        const prompt = [
          `## Task: ${args.title}`,
          ``,
          args.description,
          args.context ? `\nContext: ${args.context}` : "",
          args.files?.length ? `\nRelevant files:\n${args.files.map((f) => `- ${f}`).join("\n")}` : "",
          `\nPlease complete this task and summarize what you did.`,
        ]
          .filter(Boolean)
          .join("\n")

        const response = await orch.promptAgent(args.target, prompt)

        orch.registry.updateStatus(args.target, "idle")
        await orch.audit.append({ agent: args.target, action: "task.completed", target: taskId })
        return response || `Task "${args.title}" completed by ${args.target}`
      } catch (err) {
        orch.registry.updateStatus(args.target, "idle")
        await orch.audit.append({
          agent: args.target,
          action: "task.failed",
          target: taskId,
          details: { error: err instanceof Error ? err.message : String(err) },
        })
        return `Error: ${err instanceof Error ? err.message : String(err)}`
      }
    },
  })
}
