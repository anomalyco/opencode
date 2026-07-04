export * as ExecuteTool from "./execute"

import { CodeMode, Tool, toolError, type ToolDefinition } from "@opencode-ai/codemode"
import { Effect, Schema } from "effect"
import { definition, make, settle, type Context } from "./tool"
import type { CodeModeTools } from "./tools"

export const Input = Schema.Struct({
  code: Schema.String.annotate({ description: "Code to execute using the available tools" }),
})

const Call = Schema.Struct({
  tool: Schema.String,
  status: Schema.Literals(["running", "completed", "error"]),
  input: Schema.Unknown.pipe(Schema.optional),
})

const Attachment = Schema.Struct({
  data: Schema.String,
  mime: Schema.String,
  name: Schema.String.pipe(Schema.optional),
})

export const Output = Schema.Struct({
  output: Schema.String,
  toolCalls: Schema.Array(Call),
  error: Schema.Literal(true).pipe(Schema.optional),
  attachments: Schema.Array(Attachment),
})

type ExecuteCall = typeof Call.Type

const create = (items: CodeModeTools) => {
  const createRuntime = (calls: ExecuteCall[], attachments: Array<typeof Attachment.Type>, context?: Context) => {
    const tools: Record<string, Record<string, ToolDefinition>> = Object.create(null)
    for (const [namespace, members] of Object.entries(items)) {
      tools[namespace] = Object.create(null)
      for (const [member, item] of Object.entries(members)) {
        const info = definition(`${namespace}_${member}`, item)
        tools[namespace][member] = Tool.make({
          description: info.description,
          input: info.inputSchema,
          output: info.outputSchema,
          run: (input) => {
            if (!context) return Effect.die(new Error("Execute tool context is unavailable"))
            return settle(item, { type: "tool-call", id: context.toolCallID, name: info.name, input }, context).pipe(
              Effect.mapError((error) => toolError(error.message)),
              Effect.map((output) => {
                attachments.push(
                  ...output.content.flatMap((part) => {
                    if (part.type !== "file") return []
                    const prefix = `data:${part.mime};base64,`
                    if (!part.uri.startsWith(prefix)) return []
                    return [{ data: part.uri.slice(prefix.length), mime: part.mime, name: part.name }]
                  }),
                )
                return output.structured
              }),
            )
          },
        })
      }
    }

    return CodeMode.make({
      limits: { timeoutMs: 5 * 60_000, maxToolCalls: 100 },
      tools,
      onToolCallStart: (call) =>
        Effect.sync(() => {
          calls[call.index] = { tool: call.name, status: "running", input: call.input }
        }),
      onToolCallEnd: (call) =>
        Effect.sync(() => {
          calls[call.index] = {
            tool: call.name,
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
}

export { create as make }
