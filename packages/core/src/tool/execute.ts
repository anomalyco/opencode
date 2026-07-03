export * as ExecuteTool from "./execute"

import {
  CodeMode,
  Tool,
  toolError,
  type ExecuteResult,
  type JsonSchema,
  type ToolCallEnded,
  type ToolCallStarted,
  type ToolDefinition,
} from "@opencode-ai/codemode"
import { Effect, Schema } from "effect"
import { MCP } from "../mcp"
import { PermissionV2 } from "../permission"
import { make, type Context } from "./tool"

const LIMITS = { timeoutMs: 5 * 60_000, maxToolCalls: 100 } as const

export const Input = Schema.Struct({
  code: Schema.String.annotate({ description: "Code to execute using the available MCP tools" }),
})

const Call = Schema.Struct({
  tool: Schema.String,
  status: Schema.Literals(["running", "completed", "error"]),
  input: Schema.Unknown.pipe(Schema.optional),
})

const Attachment = Schema.Struct({
  data: Schema.String,
  mime: Schema.String,
})

export const Output = Schema.Struct({
  output: Schema.String,
  toolCalls: Schema.Array(Call),
  error: Schema.Literal(true).pipe(Schema.optional),
  attachments: Schema.Array(Attachment),
})

const Structured = Schema.Struct({
  output: Output.fields.output,
  toolCalls: Output.fields.toolCalls,
  error: Output.fields.error,
})

type ExecuteCall = typeof Call.Type

export interface Item {
  readonly action: string
  readonly tool: MCP.Tool
  readonly namespace?: string
  readonly member?: string
}

const create = Effect.fn("ExecuteTool.make")(function* (items: ReadonlyArray<Item>) {
  const mcp = yield* MCP.Service
  const permission = yield* PermissionV2.Service

  const createRuntime = (calls: ExecuteCall[], attachments: Array<typeof Attachment.Type>, context?: Context) => {
    const tools: Record<string, Record<string, ToolDefinition>> = Object.create(null)
    const names = new Map<string, string>()
    for (const item of items) {
      const namespace = item.namespace ?? item.tool.server.toString()
      const member = item.member ?? item.tool.name
      tools[namespace] ??= Object.create(null)
      tools[namespace][member] = Tool.make({
        description: item.tool.description ?? item.tool.name,
        input: jsonSchema(item.tool.inputSchema),
        run: (input) => {
          if (!context) return Effect.die(new Error("Execute tool context is unavailable"))
          const args = recordInput(input)
          return permission
            .assert({
              sessionID: context.sessionID,
              agent: context.agent,
              action: item.action,
              resources: ["*"],
              save: ["*"],
              metadata: { server: item.tool.server, tool: item.tool.name, arguments: args },
              source: {
                type: "tool",
                messageID: context.assistantMessageID,
                callID: context.toolCallID,
              },
            })
            .pipe(
              Effect.mapError((error) =>
                toolError(error instanceof PermissionV2.CorrectedError ? error.feedback : "Permission denied"),
              ),
              Effect.flatMap(() => mcp.callTool({ server: item.tool.server, name: item.tool.name, args })),
              Effect.catchTags({
                "MCP.NotFoundError": (error) => Effect.fail(toolError(`MCP server "${error.server}" is not available`)),
                "MCP.ToolCallError": (error) => Effect.fail(toolError(error.message)),
              }),
              Effect.flatMap((result) => {
                if (result.isError)
                  return Effect.fail(toolError(errorText(result.content) || "MCP tool returned an error"))
                for (const part of result.content) {
                  if (part.type === "media") attachments.push({ data: part.data, mime: part.mimeType })
                }
                return Effect.succeed(projectResult(result))
              }),
            )
        },
      })
      names.set(`${namespace}.${member}`, `${item.tool.server}.${item.tool.name}`)
    }

    return CodeMode.make({
      limits: LIMITS,
      tools,
      onToolCallStart: (call: ToolCallStarted) =>
        Effect.sync(() => {
          calls[call.index] = { tool: names.get(call.name) ?? call.name, status: "running", input: call.input }
        }),
      onToolCallEnd: (call: ToolCallEnded) =>
        Effect.sync(() => {
          calls[call.index] = {
            tool: names.get(call.name) ?? call.name,
            status: call.outcome === "failure" ? "error" : "completed",
            input: call.input,
          }
        }),
    })
  }

  return make({
    description: createRuntime([], []).instructions(),
    input: Input,
    output: Output,
    structured: Structured,
    toStructuredOutput: ({ output }) => ({
      output: output.output,
      toolCalls: output.toolCalls,
      ...(output.error ? { error: true as const } : {}),
    }),
    toModelOutput: ({ output }) => [
      { type: "text", text: output.output },
      ...output.attachments.map((attachment) => ({ type: "file" as const, ...attachment })),
    ],
    execute: (input, context) =>
      Effect.gen(function* () {
        const calls: ExecuteCall[] = []
        const attachments: Array<typeof Attachment.Type> = []
        const result = yield* createRuntime(calls, attachments, context).execute(input.code)
        return {
          output: formatResult(result),
          toolCalls: calls,
          ...(result.ok ? {} : { error: true as const }),
          attachments,
        }
      }),
  })
})

export { create as make }

function recordInput(input: unknown): Record<string, unknown> {
  return isRecord(input) ? input : {}
}

function isRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === "object" && input !== null && !Array.isArray(input)
}

function jsonSchema(input: unknown): JsonSchema {
  return isRecord(input) ? (input as JsonSchema) : { type: "object", properties: {} }
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

function formatResult(result: ExecuteResult) {
  const logs = result.logs?.length ? `\n\nLogs:\n${result.logs.join("\n")}` : ""
  if (!result.ok) return `${result.error.message}${logs}`
  if (typeof result.value === "string") return result.value + logs
  return `${JSON.stringify(result.value, null, 2) ?? "null"}${logs}`
}
