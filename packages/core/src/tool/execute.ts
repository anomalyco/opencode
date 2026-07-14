export * as ExecuteTool from "./execute"

import { CodeMode, Tool, toolError } from "@opencode-ai/codemode"
import { ToolOutput } from "@opencode-ai/llm"
import { Effect, Ref, Schema } from "effect"
import { definition, make, settle, type AnyTool } from "./tool"

const ExecuteFile = Schema.Struct({
  data: Schema.String,
  mime: Schema.String,
  name: Schema.optionalKey(Schema.String),
})

const ExecuteCall = Schema.Struct({
  tool: Schema.String,
  status: Schema.Literals(["running", "completed", "error"]),
  input: Schema.optionalKey(Schema.Record(Schema.String, Schema.Unknown)),
})

type ExecuteCall = typeof ExecuteCall.Type

const ExecuteMetadata = Schema.Struct({
  toolCalls: Schema.Array(ExecuteCall),
  error: Schema.optionalKey(Schema.Literal(true)),
})

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

interface Registration {
  readonly tool: AnyTool
  readonly name: string
  readonly group?: string
}

export const create = (registrations: ReadonlyMap<string, Registration>) => {
  const runtime = (
    invoke: (name: string, registration: Registration, input: unknown) => Effect.Effect<unknown, unknown>,
    hooks?: CodeMode.ToolCallHooks,
  ) => {
    const tools: Record<string, Tool.Definition<never> | Record<string, Tool.Definition<never>>> = {}
    for (const [name, registration] of registrations) {
      const child = definition(name, registration.tool)
      const value = Tool.make({
        description: child.description,
        input: child.inputSchema,
        output: child.outputSchema,
        run: (input) => invoke(name, registration, input),
      })
      if (registration.group === undefined) {
        const path = registration.name
        if (Object.hasOwn(tools, path)) throw new TypeError(`CodeMode tool namespace conflict: ${path}`)
        tools[path] = value
        continue
      }
      const path = registration.name
      const namespace = registration.group
      const group = tools[namespace]
      if (group && Tool.isDefinition(group)) throw new TypeError(`CodeMode tool namespace conflict: ${namespace}`)
      if (group) {
        if (Object.hasOwn(group, path)) throw new TypeError(`CodeMode tool namespace conflict: ${namespace}.${path}`)
        group[path] = value
        continue
      }
      const entries: Record<string, Tool.Definition<never>> = {}
      entries[path] = value
      tools[namespace] = entries
    }
    return CodeMode.make<typeof tools>({ tools, ...hooks })
  }
  const discovery = runtime(() => Effect.fail(toolError("Execute context is unavailable")))
  return make({
    description: discovery.instructions(),
    input: CodeMode.Input,
    output: ExecuteOutput,
    structured: ExecuteMetadata,
    toStructuredOutput: ({ output }) => ({
      toolCalls: output.toolCalls,
      ...(output.error ? { error: true as const } : {}),
    }),
    toModelOutput: ({ output }) => [
      { type: "text" as const, text: output.output },
      ...output.files.map((file) => ({
        type: "file" as const,
        data: file.data,
        mime: file.mime,
        ...(file.name === undefined ? {} : { name: file.name }),
      })),
    ],
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
          (name, registration, input) =>
            Effect.gen(function* () {
              const index = yield* Ref.getAndUpdate(callIndex, (index) => index + 1)
              const output = yield* settle(
                registration.tool,
                { type: "tool-call", id: context.callID, name, input },
                {
                  sessionID: context.sessionID,
                  agent: context.agent,
                  messageID: context.messageID,
                  callID: context.callID,
                  progress: context.progress,
                },
              ).pipe(Effect.mapError((failure) => toolError(failure.message, failure)))
              const outputFileParts = outputFiles(output)
              if (outputFileParts.length > 0)
                yield* Ref.update(files, (items) => [...items, { index, files: outputFileParts }])
              return output.structured
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
        return { output, toolCalls, files: collected, ...(result.ok ? {} : { error: true as const }) }
      }),
  })
}

function displayInput(input: unknown): Record<string, unknown> | undefined {
  if (input === null || input === undefined) return
  if (typeof input !== "object" || Array.isArray(input)) return { input }
  if (Object.keys(input).length === 0) return
  return input as Record<string, unknown>
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

function outputFiles(output: ToolOutput): Array<typeof ExecuteFile.Type> {
  return output.content.flatMap((part) => {
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
