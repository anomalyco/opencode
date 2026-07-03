export * as ExecuteTool from "./execute"

import {
  CodeMode,
  Tool as CodeModeTool,
  toolError,
  type ExecuteResult,
  type JsonSchema as CodeModeJsonSchema,
  type ToolCallEnded,
  type ToolCallStarted,
  type ToolDefinition as CodeModeDefinition,
} from "@opencode-ai/codemode"
import { ToolFailure } from "@opencode-ai/llm"
import { Effect, type JsonSchema } from "effect"
import { MCP } from "../mcp"
import { Tool } from "./tool"

const inputSchema = {
  type: "object",
  properties: {
    code: { type: "string" },
  },
  required: ["code"],
  additionalProperties: false,
} as const satisfies JsonSchema.JsonSchema

type ExecuteCall = { tool: string; status: "running" | "completed" | "error"; input?: unknown }
type Authorize = (input: {
  readonly tool: MCP.Tool
  readonly args: Record<string, unknown>
  readonly context: Tool.Context
}) => Effect.Effect<void, unknown>

export function make(items: ReadonlyArray<MCP.Tool>, callTool: MCP.Interface["callTool"], authorize?: Authorize) {
  const createRuntime = (calls: ExecuteCall[], attachments: Tool.Content[], context?: Tool.Context) =>
    CodeMode.make({
      tools: items.reduce<Record<string, Record<string, CodeModeDefinition>>>((acc, item) => {
        const server = item.server.toString()
        acc[server] ??= {}
        acc[server][item.name] = CodeModeTool.make({
          description: item.description ?? item.name,
          input: (item.inputSchema as CodeModeJsonSchema | undefined) ?? { type: "object", properties: {} },
          run: (input) => {
            const args = recordInput(input)
            return (authorize && context ? authorize({ tool: item, args, context }) : Effect.void).pipe(
              Effect.mapError((error) => toolError(permissionError(error))),
              Effect.flatMap(() => callTool({ server: item.server, name: item.name, args })),
              Effect.catchTags({
                "MCP.NotFoundError": (error) => Effect.fail(toolError(`MCP server "${error.server}" is not available`)),
                "MCP.ToolCallError": (error) => Effect.fail(toolError(error.message)),
              }),
              Effect.flatMap((result) => {
                if (result.isError) return Effect.fail(toolError(errorText(result.content) || "MCP tool returned an error"))
                for (const part of result.content) {
                  if (part.type === "media") attachments.push({ type: "file", data: part.data, mime: part.mimeType })
                }
                return Effect.succeed(projectResult(result))
              }),
            )
          },
        })
        return acc
      }, {}),
      onToolCallStart: (call: ToolCallStarted) =>
        Effect.sync(() => {
          calls[call.index] = { tool: call.name, status: "running", input: call.input }
        }),
      onToolCallEnd: (call: ToolCallEnded) =>
        Effect.sync(() => {
          calls[call.index] = {
            tool: call.name,
            status: call.outcome === "failure" ? "error" : "completed",
            input: call.input,
          }
        }),
    })

  return Tool.make({
    description: createRuntime([], []).instructions(),
    jsonSchema: inputSchema,
    execute: (input, context) =>
      Effect.gen(function* () {
        const value = recordInput(input).code
        if (typeof value !== "string") return yield* new ToolFailure({ message: "Invalid tool input: expected code string" })
        const calls: ExecuteCall[] = []
        const attachments: Tool.Content[] = []
        const result = yield* createRuntime(calls, attachments, context).execute(value)
        const output = formatResult(result)
        return {
          structured: {
            output,
            toolCalls: calls,
            ...(result.ok ? {} : { error: true }),
          },
          content: [{ type: "text" as const, text: output }, ...attachments],
        }
      }),
  })
}

function recordInput(input: unknown): Record<string, unknown> {
  if (typeof input !== "object" || input === null || Array.isArray(input)) return {}
  return input as Record<string, unknown>
}

function errorText(content: ReadonlyArray<MCP.ToolResultContent>) {
  return content
    .flatMap((part) => (part.type === "text" ? [part.text] : []))
    .join("\n")
    .trim()
}

function projectResult(result: MCP.ToolResult) {
  if (result.structured !== undefined) return result.structured
  const text = errorText(result.content)
  const media = result.content.filter((part) => part.type === "media").length
  if (media === 0) return text
  return [text, `[${media} media attachment${media === 1 ? "" : "s"}]`].filter(Boolean).join("\n")
}

function permissionError(error: unknown) {
  if (typeof error === "object" && error !== null && "_tag" in error) return `Permission denied: ${String(error._tag)}`
  return "Permission denied"
}

function formatResult(result: ExecuteResult) {
  const logs = result.logs?.length ? `\n\nLogs:\n${result.logs.join("\n")}` : ""
  if (!result.ok) return `${result.error.message}${logs}`
  if (typeof result.value === "string") return result.value + logs
  return `${JSON.stringify(result.value, null, 2) ?? "null"}${logs}`
}
