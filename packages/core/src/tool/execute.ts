export * as ExecuteTool from "./execute"

import { CodeMode, Tool, toolError, type ToolDefinition } from "@opencode-ai/codemode"
import { Effect, Schema } from "effect"
import { MCP } from "../mcp"
import { PermissionV2 } from "../permission"
import { make, type Context } from "./tool"

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

type ExecuteCall = typeof Call.Type

const create = Effect.fn("ExecuteTool.make")(function* (items: ReadonlyArray<MCP.Tool>) {
  const mcp = yield* MCP.Service
  const permission = yield* PermissionV2.Service

  const createRuntime = (calls: ExecuteCall[], attachments: Array<typeof Attachment.Type>, context?: Context) => {
    const tools: Record<string, Record<string, ToolDefinition>> = Object.create(null)
    const names = new Map<string, string>()
    for (const item of items) {
      const namespace = item.server.toString().replace(/[^A-Za-z0-9_-]/g, "_")
      const member = item.name.replace(/[^A-Za-z0-9_-]/g, "_")
      tools[namespace] ??= Object.create(null)
      tools[namespace][member] = Tool.make({
        description: item.description ?? item.name,
        input:
          typeof item.inputSchema === "object" && item.inputSchema !== null && !Array.isArray(item.inputSchema)
            ? { ...item.inputSchema }
            : { type: "object", properties: {} },
        run: (input) => {
          if (!context) return Effect.die(new Error("Execute tool context is unavailable"))
          const args = typeof input === "object" && input !== null && !Array.isArray(input) ? { ...input } : {}
          return permission
            .assert({
              sessionID: context.sessionID,
              agent: context.agent,
              action: `mcp:${item.server}:${item.name}`,
              resources: ["*"],
              save: ["*"],
              metadata: { server: item.server, tool: item.name, arguments: args },
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
              Effect.flatMap(() => mcp.callTool({ server: item.server, name: item.name, args })),
              Effect.catchTags({
                "MCP.NotFoundError": (error) => Effect.fail(toolError(`MCP server "${error.server}" is not available`)),
                "MCP.ToolCallError": (error) => Effect.fail(toolError(error.message)),
              }),
              Effect.flatMap((result) => {
                const text = result.content
                  .flatMap((part) => (part.type === "text" ? [part.text] : []))
                  .join("\n")
                  .trim()
                if (result.isError) return Effect.fail(toolError(text || "MCP tool returned an error"))
                attachments.push(
                  ...result.content.flatMap((part) =>
                    part.type === "media" ? [{ data: part.data, mime: part.mimeType }] : [],
                  ),
                )
                if (result.structured !== undefined) return Effect.succeed(result.structured)
                const media = result.content.filter((part) => part.type === "media").length
                if (media === 0) return Effect.succeed(text)
                return Effect.succeed(
                  [text, `[${media} media attachment${media === 1 ? "" : "s"}]`].filter(Boolean).join("\n"),
                )
              }),
            )
        },
      })
      names.set(`${namespace}.${member}`, `${item.server}.${item.name}`)
    }

    return CodeMode.make({
      limits: { timeoutMs: 5 * 60_000, maxToolCalls: 100 },
      tools,
      onToolCallStart: (call) =>
        Effect.sync(() => {
          calls[call.index] = { tool: names.get(call.name) ?? call.name, status: "running", input: call.input }
        }),
      onToolCallEnd: (call) =>
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
    structured: Schema.Struct({
      output: Output.fields.output,
      toolCalls: Output.fields.toolCalls,
      error: Output.fields.error,
    }),
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
        const logs = result.logs?.length ? `\n\nLogs:\n${result.logs.join("\n")}` : ""
        return {
          output: !result.ok
            ? `${result.error.message}${logs}`
            : typeof result.value === "string"
              ? result.value + logs
              : `${JSON.stringify(result.value, null, 2) ?? "null"}${logs}`,
          toolCalls: calls,
          ...(result.ok ? {} : { error: true as const }),
          attachments,
        }
      }),
  })
})

export { create as make }
