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
import { Effect, Schema } from "effect"
import { MCP } from "../mcp"
import { PermissionV2 } from "../permission"
import { Tool } from "./tool"

const limits = { timeoutMs: 5 * 60_000, maxToolCalls: 100 } as const

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

export const make = Effect.fn("ExecuteTool.make")(function* (items: ReadonlyArray<Item>) {
  const mcp = yield* MCP.Service
  const permission = yield* PermissionV2.Service

  const createRuntime = (calls: ExecuteCall[], attachments: Array<typeof Attachment.Type>, context?: Tool.Context) => {
    const tools: Record<string, Record<string, CodeModeDefinition>> = Object.create(null)
    const names = new Map<string, string>()
    for (const item of items) {
      const namespace = item.namespace ?? item.tool.server.toString()
      const member = item.member ?? item.tool.name
      tools[namespace] ??= Object.create(null)
      tools[namespace][member] = CodeModeTool.make({
        description: item.tool.description ?? item.tool.name,
        input: codeModeJsonSchema(item.tool.inputSchema),
        run: (input) => {
          const args = recordInput(input)
          return (context
            ? permission.assert({
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
            : Effect.die("Execute tool context is unavailable")
          ).pipe(
            Effect.mapError((error) => toolError(permissionError(error))),
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
      limits,
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

  return Tool.make({
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

function recordInput(input: unknown): Record<string, unknown> {
  return isRecord(input) ? input : {}
}

function isRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === "object" && input !== null && !Array.isArray(input)
}

function codeModeJsonSchema(input: unknown): CodeModeJsonSchema {
  if (!isRecord(input)) return { type: "object", properties: {} }
  const type =
    typeof input.type === "string"
      ? input.type
      : Array.isArray(input.type) && input.type.every((item) => typeof item === "string")
        ? input.type
        : undefined
  const properties = isRecord(input.properties)
    ? Object.fromEntries(Object.entries(input.properties).map(([key, value]) => [key, codeModeJsonSchema(value)]))
    : undefined
  const schemas = (value: unknown) =>
    Array.isArray(value) ? value.filter(isRecord).map(codeModeJsonSchema) : undefined
  const definitions = (value: unknown) =>
    isRecord(value)
      ? Object.fromEntries(Object.entries(value).map(([key, schema]) => [key, codeModeJsonSchema(schema)]))
      : undefined
  return {
    ...(type ? { type } : {}),
    ...(Array.isArray(input.enum) ? { enum: input.enum } : {}),
    ...(Object.hasOwn(input, "const") ? { const: input.const } : {}),
    ...(schemas(input.anyOf) ? { anyOf: schemas(input.anyOf) } : {}),
    ...(schemas(input.oneOf) ? { oneOf: schemas(input.oneOf) } : {}),
    ...(properties ? { properties } : {}),
    ...(Array.isArray(input.required) && input.required.every((item) => typeof item === "string")
      ? { required: input.required }
      : {}),
    ...(isRecord(input.items) ? { items: codeModeJsonSchema(input.items) } : {}),
    ...(typeof input.additionalProperties === "boolean"
      ? { additionalProperties: input.additionalProperties }
      : isRecord(input.additionalProperties)
        ? { additionalProperties: codeModeJsonSchema(input.additionalProperties) }
        : {}),
    ...(typeof input.description === "string" ? { description: input.description } : {}),
    ...(Object.hasOwn(input, "default") ? { default: input.default } : {}),
    ...(typeof input.format === "string" ? { format: input.format } : {}),
    ...(typeof input.deprecated === "boolean" ? { deprecated: input.deprecated } : {}),
    ...(typeof input.minItems === "number" ? { minItems: input.minItems } : {}),
    ...(typeof input.maxItems === "number" ? { maxItems: input.maxItems } : {}),
    ...(typeof input.$ref === "string" ? { $ref: input.$ref } : {}),
    ...(definitions(input.$defs) ? { $defs: definitions(input.$defs) } : {}),
    ...(definitions(input.definitions) ? { definitions: definitions(input.definitions) } : {}),
  }
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
  if (error instanceof PermissionV2.CorrectedError) return error.feedback
  if (typeof error === "object" && error !== null && "_tag" in error)
    return `Permission denied: ${String(error._tag)}`
  return "Permission denied"
}

function formatResult(result: ExecuteResult) {
  const logs = result.logs?.length ? `\n\nLogs:\n${result.logs.join("\n")}` : ""
  if (!result.ok) return `${result.error.message}${logs}`
  if (typeof result.value === "string") return result.value + logs
  return `${JSON.stringify(result.value, null, 2) ?? "null"}${logs}`
}
