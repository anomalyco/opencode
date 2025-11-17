import z from "zod"
import { Tool } from "./tool"
import DESCRIPTION from "./batch.txt"

const DISALLOWED = new Set(["batch", "edit", "todoread"])
const FILTERED_FROM_SUGGESTIONS = new Set(["invalid", "patch", ...DISALLOWED])

export const BatchTool = Tool.define("batch", async () => {
  return {
    description: DESCRIPTION,
    parameters: z.object({
      tool_calls: z
        .array(
          z.object({
            tool: z.string().describe("The name of the tool to execute"),
            parameters: z.object({}).loose().describe("Parameters for the tool"),
          }),
        )
        .min(1, "Provide at least one tool call")
        .max(10, "Too many tools in batch. Maximum allowed is 10.")
        .describe("Array of tool calls to execute in parallel"),
    }),
    formatValidationError(error) {
      const formattedErrors = error.issues
        .map((issue) => {
          const path = issue.path.length > 0 ? issue.path.join(".") : "root"
          return `  - ${path}: ${issue.message}`
        })
        .join("\n")

      return `Invalid parameters for tool 'batch':\n${formattedErrors}\n\nExpected payload format:\n  [{"tool": "tool_name", "parameters": {...}}, {...}]`
    },
    async execute(params, ctx) {
      const { Session } = await import("../session")
      const { Identifier } = await import("../id/id")

      const toolCalls = params.tool_calls

      const { ToolRegistry } = await import("./registry")
      const availableTools = await ToolRegistry.tools("", "")
      const toolMap = new Map(availableTools.map((t) => [t.id, t]))

      const partIDs = new Map<(typeof toolCalls)[0], string>()
      for (const call of toolCalls) {
        const partID = Identifier.ascending("part")
        partIDs.set(call, partID)
        Session.updatePart({
          id: partID,
          messageID: ctx.messageID,
          sessionID: ctx.sessionID,
          type: "tool",
          tool: call.tool,
          callID: partID,
          state: {
            status: "pending",
            input: call.parameters,
            raw: JSON.stringify(call),
          },
        })
      }

      const executeCall = async (call: (typeof toolCalls)[0]) => {
        const callStartTime = Date.now()
        const partID = partIDs.get(call)!

        try {
          if (DISALLOWED.has(call.tool)) {
            throw new Error(
              `Tool '${call.tool}' is not allowed in batch. Disallowed tools: ${Array.from(DISALLOWED).join(", ")}`,
            )
          }

          const tool = toolMap.get(call.tool)
          if (!tool) {
            const availableToolsList = Array.from(toolMap.keys()).filter((name) => !FILTERED_FROM_SUGGESTIONS.has(name))
            throw new Error(`Tool '${call.tool}' not found. Available tools: ${availableToolsList.join(", ")}`)
          }
          const validatedParams = tool.parameters.parse(call.parameters)

          const result = await tool.execute(validatedParams, { ...ctx, callID: partID })

          await Session.updatePart({
            id: partID,
            messageID: ctx.messageID,
            sessionID: ctx.sessionID,
            type: "tool",
            tool: call.tool,
            callID: partID,
            state: {
              status: "completed",
              input: call.parameters,
              output: result.output,
              title: result.title,
              metadata: result.metadata,
              attachments: result.attachments,
              time: {
                start: callStartTime,
                end: Date.now(),
              },
            },
          })

          return { success: true as const, tool: call.tool, result }
        } catch (error) {
          await Session.updatePart({
            id: partID,
            messageID: ctx.messageID,
            sessionID: ctx.sessionID,
            type: "tool",
            tool: call.tool,
            callID: partID,
            state: {
              status: "error",
              input: call.parameters,
              error: error instanceof Error ? error.message : String(error),
              time: {
                start: callStartTime,
                end: Date.now(),
              },
            },
          })

          return { success: false as const, tool: call.tool, error }
        }
      }

      const results = await Promise.all(toolCalls.map((call) => executeCall(call)))

      const successfulCalls = results.filter((r) => r.success).length
      const failedCalls = toolCalls.length - successfulCalls

      const outputParts = results.map((r) => {
        if (r.success) {
          return `<tool_result name="${r.tool}">\n${r.result.output}\n</tool_result>`
        }
        const errorMessage = r.error instanceof Error ? r.error.message : String(r.error)
        return `<tool_result name="${r.tool}">\nError: ${errorMessage}\n</tool_result>`
      })

      const outputMessage =
        failedCalls > 0
          ? `Executed ${successfulCalls}/${toolCalls.length} tools successfully. ${failedCalls} failed.\n\n${outputParts.join("\n\n")}`
          : `All ${successfulCalls} tools executed successfully.\n\n${outputParts.join("\n\n")}\n\nKeep using the batch tool for optimal performance in your next response!`

      return {
        title: `Batch execution (${successfulCalls}/${toolCalls.length} successful)`,
        output: outputMessage,
        attachments: results.filter((result) => result.success).flatMap((r) => r.result.attachments ?? []),
        metadata: {
          totalCalls: toolCalls.length,
          successful: successfulCalls,
          failed: failedCalls,
          tools: toolCalls.map((c) => c.tool),
          details: results.map((r) => ({ tool: r.tool, success: r.success })),
        },
      }
    },
  }
})
