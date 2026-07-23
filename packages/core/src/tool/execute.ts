export * as ExecuteTool from "./execute"
export type { Registration } from "./tool"

import { CodeMode, Tool, toolError } from "@opencode-ai/codemode"
import type { ToolContent } from "@opencode-ai/ai"
import { Effect, Ref, Schema } from "effect"
import { execute, make, toLLMDefinition, type Content, type Metadata, type Registration } from "./tool"

const ExecuteFile = Schema.Struct({
  data: Schema.String,
  mime: Schema.String,
  name: Schema.optionalKey(Schema.String),
})

const ExecuteCall = Schema.Struct({
  tool: Schema.String,
  status: Schema.Literals(["running", "completed", "error"]),
  input: Schema.optionalKey(Schema.Record(Schema.String, Schema.Json)),
})

type ExecuteCall = typeof ExecuteCall.Type

const ExecuteOutput = Schema.Struct({
  output: Schema.String,
  toolCalls: Schema.Array(ExecuteCall),
  error: Schema.optionalKey(Schema.Literal(true)),
  files: Schema.Array(ExecuteFile),
})

type CollectedFiles = {
  readonly index: number
  readonly files: Array<typeof ExecuteFile.Type>
}

// Invariant model-facing guidance; the changing tool catalog is delivered through Instructions.
const description = [
  "Run JavaScript in a confined Code Mode runtime through { code }.",
  "Call Code Mode tools through `tools` using the exact paths and signatures from the instructions.",
  "Use `search({ query })` to discover exact signatures when needed.",
  "Await important calls and use `Promise.all` for independent calls.",
].join("\n")

export const create = (registrations: ReadonlyMap<string, Registration>) => {
  return make({
    description,
    input: CodeMode.Input,
    output: ExecuteOutput,
    execute: ({ code }, context) =>
      Effect.gen(function* () {
        const callIndex = yield* Ref.make(0)
        const files = yield* Ref.make<Array<CollectedFiles>>([])
        const calls = yield* Ref.make<Array<ExecuteCall>>([])
        // TODO: Publish live call-list updates once V2 has a generic tool progress API.
        const finalCalls = Ref.get(calls).pipe(
          Effect.map((items) =>
            items.map((call) => (call.status === "running" ? { ...call, status: "error" as const } : call)),
          ),
        )
        const result = yield* runtime(
          registrations,
          (name, registration, input) =>
            Effect.gen(function* () {
              const index = yield* Ref.getAndUpdate(callIndex, (index) => index + 1)
              const executed = yield* execute(registration.tool, input, {
                sessionID: context.sessionID,
                agent: context.agent,
                messageID: context.messageID,
                callID: context.callID,
                progress: context.progress,
              }).pipe(Effect.mapError((failure) => toolError(failure.message, failure)))
              const outputFileParts = outputFiles(executed.content)
              if (outputFileParts.length > 0)
                yield* Ref.update(files, (items) => [...items, { index, files: outputFileParts }])
              return executed.output
            }),
          {
            onToolCallStart: ({ index, name, input }) =>
              Effect.gen(function* () {
                const shown = displayInput(input)
                yield* Ref.update(calls, (items) => {
                  const next = [...items]
                  next[index] = { tool: name, status: "running", ...(shown ? { input: shown } : {}) }
                  return next
                })
              }),
            onToolCallEnd: ({ index, outcome }) =>
              Ref.update(calls, (items) => {
                const current = items[index]
                if (!current) return items
                const next = [...items]
                next[index] = { ...current, status: outcome === "success" ? "completed" : "error" }
                return next
              }),
          },
        ).execute(code)
        const toolCalls = yield* finalCalls
        const collected = (yield* Ref.get(files))
          .toSorted((left, right) => left.index - right.index)
          .flatMap((item) => item.files)
        const output = formatResult(result)
        const value: typeof ExecuteOutput.Type = {
          output,
          toolCalls,
          files: collected,
          ...(result.ok ? {} : { error: true }),
        }
        const content: [Content, ...Content[]] = [{ type: "text", text: value.output }]
        content.push(
          ...value.files.map((file) => ({
            type: "file" as const,
            data: file.data,
            mime: file.mime,
            ...(file.name === undefined ? {} : { name: file.name }),
          })),
        )
        const metadata: Metadata = {
          toolCalls: value.toolCalls,
          ...(value.error ? { error: true } : {}),
        }
        return {
          output: value,
          content,
          metadata,
        }
      }),
  })
}

export const instructions = (registrations: ReadonlyMap<string, Registration>) => {
  return runtime(registrations, () => Effect.fail(toolError("Execute context is unavailable"))).instructions()
}

function runtime(
  registrations: ReadonlyMap<string, Registration>,
  executeTool: (name: string, registration: Registration, input: unknown) => Effect.Effect<unknown, unknown>,
  hooks?: CodeMode.ToolCallHooks,
) {
  const tools: Record<string, Tool.Tool<never>> = {}
  for (const [name, registration] of registrations) {
    const child = toLLMDefinition(name, registration.tool)
    const path =
      registration.namespace === undefined ? registration.name : `${registration.namespace}.${registration.name}`
    tools[path] = Tool.make({
      description: child.description,
      input: child.inputSchema,
      output: child.outputSchema,
      execute: (input) => executeTool(name, registration, input),
    })
  }
  return CodeMode.make<typeof tools>({ tools, ...hooks })
}

// Tool inputs arrive as parsed JSON, so the JSON value cast is a boundary fact.
function displayInput(input: unknown): Record<string, typeof Schema.Json.Type> | undefined {
  if (input === null || input === undefined) return
  if (typeof input !== "object" || Array.isArray(input)) return { input: input as typeof Schema.Json.Type }
  if (Object.keys(input).length === 0) return
  return input as Record<string, typeof Schema.Json.Type>
}

function formatResult(result: CodeMode.Result) {
  const output = result.ok
    ? formatValue(result.value)
    : [result.error.message, ...(result.error.suggestions ?? []).filter((hint) => !result.error.message.includes(hint))]
        .join("\n")
        .trim()
  const warnings =
    result.ok && result.warnings && result.warnings.length > 0
      ? `Warnings:\n${result.warnings.map((item) => `- [${item.kind}] ${item.message}`).join("\n")}`
      : undefined
  const logs = result.logs && result.logs.length > 0 ? `Logs:\n${result.logs.join("\n")}` : undefined
  return [output, warnings, logs].filter((part) => part !== undefined && part !== "").join("\n\n")
}

function formatValue(value: CodeMode.DataValue) {
  if (typeof value === "string") return value
  return JSON.stringify(value, null, 2) ?? String(value)
}

function outputFiles(content: ReadonlyArray<ToolContent>): Array<typeof ExecuteFile.Type> {
  return content.flatMap((part) => {
    if (part.type !== "file") return []
    const prefix = `data:${part.mime};base64,`
    if (!part.uri.startsWith(prefix)) return []
    return [
      {
        data: part.uri.slice(prefix.length),
        mime: part.mime,
        ...(part.name === undefined ? {} : { name: part.name }),
      },
    ]
  })
}
