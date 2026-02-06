import z from "zod"
import { Tool } from "./tool"
import DESCRIPTION from "./batch.txt"
import { MessageV2 } from "../session/message-v2"

const DISALLOWED = new Set(["batch"])
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

      const toolCalls = params.tool_calls.slice(0, 25)
      const discardedCalls = params.tool_calls.slice(25)

      const { ToolRegistry } = await import("./registry")
      const availableTools = await ToolRegistry.tools({ modelID: "", providerID: "" })
      const toolMap = new Map(availableTools.map((t) => [t.id, t]))

      // Bug 7: Dependency analysis for BatchTool
      const { ToolDependency } = await import("../session/tool-dependency")
      const { MessageV2 } = await import("../session/message-v2")

      const fakeToolParts: MessageV2.ToolPart[] = toolCalls.map((call, index) => ({
        id: `batch-${index}`,
        sessionID: ctx.sessionID,
        messageID: ctx.messageID,
        type: "tool",
        callID: `batch-${index}`,
        tool: call.tool,
        state: {
          status: "pending",
          input: call.parameters,
          raw: "",
        },
      }))

      const dependencyResult = ToolDependency.analyze(fakeToolParts)

      const results: Array<{ success: boolean; tool: string; result?: any; error?: any }> = []
      const resultsMap = new Map<string, any>()

      const executeCall = async (call: (typeof toolCalls)[0], partID: string) => {
        const callStartTime = Date.now()

        try {
          if (DISALLOWED.has(call.tool)) {
            throw new Error(
              `Tool '${call.tool}' is not allowed in batch. Disallowed tools: ${Array.from(DISALLOWED).join(", ")}`,
            )
          }

          const tool = toolMap.get(call.tool)
          if (!tool) {
            const availableToolsList = Array.from(toolMap.keys()).filter((name) => !FILTERED_FROM_SUGGESTIONS.has(name))
            throw new Error(
              `Tool '${call.tool}' not in registry. External tools (MCP, environment) cannot be batched - call them directly. Available tools: ${availableToolsList.join(", ")}`,
            )
          }
          const validatedParams = tool.parameters.parse(call.parameters)

          await Session.updatePart({
            id: partID,
            messageID: ctx.messageID,
            sessionID: ctx.sessionID,
            type: "tool",
            tool: call.tool,
            callID: partID,
            state: {
              status: "running",
              input: call.parameters,
              time: {
                start: callStartTime,
              },
            },
          })

          // Bug 8: Add timeout handling
          const timeout = 60_000 // 60s default timeout for batch sub-tools
          const resultPromise = tool.execute(validatedParams, { ...ctx, callID: partID })
          const timeoutPromise = new Promise((_, reject) =>
            setTimeout(() => reject(new Error(`Tool '${call.tool}' timed out after ${timeout}ms`)), timeout),
          )

          const result = (await Promise.race([resultPromise, timeoutPromise])) as any
          const attachments = result.attachments?.map((attachment: any) => ({
            ...attachment,
            id: Identifier.ascending("part"),
            messageID: ctx.messageID,
            sessionID: ctx.sessionID,
          }))

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
              attachments,
              time: {
                start: callStartTime,
                end: Date.now(),
              },
            },
          })

          resultsMap.set(partID, result)
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

      // Execute level by level
      for (const level of dependencyResult.levels) {
        const levelPromises = level.calls.map((callPart) => {
          const index = parseInt(callPart.id.split("-")[1]!)
          const call = toolCalls[index]!
          return executeCall(call, callPart.id)
        })
        const levelResults = await Promise.all(levelPromises)
        results.push(...levelResults)
      }

      // Add discarded calls as errors
      const now = Date.now()
      for (const call of discardedCalls) {
        const partID = Identifier.ascending("part")
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
            error: "Maximum of 25 tools allowed in batch",
            time: { start: now, end: now },
          },
        })
        results.push({
          success: false as const,
          tool: call.tool,
          error: new Error("Maximum of 25 tools allowed in batch"),
        })
      }

      const successfulCalls = results.filter((r) => r.success).length
      const failedCalls = results.length - successfulCalls

      const outputMessage =
        failedCalls > 0
          ? `Executed ${successfulCalls}/${results.length} tools successfully. ${failedCalls} failed.`
          : `All ${successfulCalls} tools executed successfully.\n\nKeep using the batch tool for optimal performance in your next response!`

      return {
        title: `Batch execution (${successfulCalls}/${results.length} successful)`,
        output: outputMessage,
        attachments: results.filter((result) => result.success).flatMap((r) => r.result.attachments ?? []),
        metadata: {
          totalCalls: results.length,
          successful: successfulCalls,
          failed: failedCalls,
          tools: params.tool_calls.map((c) => c.tool),
          details: results.map((r) => ({ tool: r.tool, success: r.success })),
        },
      }
    },
    getTimeout(params) {
      // Batch tool itself has no strict timeout, but sub-tools do.
      // We return 0 to indicate no timeout for the batch manager.
      return 0
    },
    getResourceKeys(params) {
      const keys = new Set<string>()
      // Batch tool accesses resources of all its sub-tools
      const registry = require("./registry")
      const ToolRegistry = registry.ToolRegistry || registry
      for (const call of params.tool_calls) {
        const tool = ToolRegistry.getToolSync?.(call.tool)
        if (tool?.getResourceKeys) {
          const subKeys = tool.getResourceKeys(call.parameters)
          for (const k of subKeys) keys.add(k)
        }
      }
      return keys
    },
    getDependencies(params) {
      // Batch tool might depend on other tools if sub-tools do.
      const deps: string[] = []
      const registry = require("./registry")
      const ToolRegistry = registry.ToolRegistry || registry
      for (const call of params.tool_calls) {
        const tool = ToolRegistry.getToolSync?.(call.tool)
        if (tool?.getDependencies) {
          const subDeps = tool.getDependencies(call.parameters)
          deps.push(...subDeps)
        }
      }
      return deps
    },
  }
})
