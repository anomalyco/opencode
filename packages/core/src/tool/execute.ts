export * as ExecuteTool from "./execute"

import { CodeMode, Tool, toolError, type ToolDefinition } from "@opencode-ai/codemode"
import { type ToolOutput, type ToolResultValue } from "@opencode-ai/llm"
import { Effect, Schema } from "effect"
import { make, type Context } from "./tool"

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

export interface Invocation {
  readonly result: ToolResultValue
  readonly output?: ToolOutput
}

export interface Item {
  readonly description: string
  readonly input: ToolDefinition["input"]
  readonly output: ToolDefinition["output"]
  readonly invoke: (input: unknown, callID: string, context: Context) => Effect.Effect<Invocation, unknown>
}

export type Items = Readonly<Record<string, Readonly<Record<string, Item>>>>
type ExecuteCall = typeof Call.Type

export const makeTool = (items: Items) => {
  const createRuntime = (calls: ExecuteCall[], attachments: Array<typeof Attachment.Type>, context?: Context) => {
    const tools: Record<string, Record<string, ToolDefinition>> = Object.create(null)
    let child = 0
    for (const [namespace, members] of Object.entries(items)) {
      tools[namespace] = Object.create(null)
      for (const [member, item] of Object.entries(members)) {
        tools[namespace][member] = Tool.make({
          description: item.description,
          input: item.input,
          output: item.output,
          run: (input) => {
            if (!context) return Effect.die(new Error("Execute tool context is unavailable"))
            const callID = `${context.toolCallID}/${child++}`
            return item.invoke(input, callID, context).pipe(
              Effect.mapError((error) => toolError("Tool execution failed", error)),
              Effect.flatMap((invocation) => {
                if (invocation.result.type === "error") return Effect.fail(toolError(invocation.result.value))
                if (!invocation.output) return Effect.succeed(invocation.result.value)
                attachments.push(
                  ...invocation.output.content.flatMap((part) => {
                    if (part.type !== "file") return []
                    const prefix = `data:${part.mime};base64,`
                    if (!part.uri.startsWith(prefix)) return []
                    return [{ data: part.uri.slice(prefix.length), mime: part.mime, name: part.name }]
                  }),
                )
                return Effect.succeed(invocation.output.structured)
              }),
            )
          },
        })
      }
    }

    return CodeMode.make({
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
