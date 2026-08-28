export * as CodeModeTool from "./tool.js"

import { CodeMode, Tool, toolError } from "@opencode-ai/codemode"
import type { Content, Context, Error, Info, Metadata, Result } from "@opencode-ai/schema/tool"
import { Effect, Ref, Schema, Semaphore } from "effect"
import { definition, normalizedName } from "../tool/runtime.js"

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
  "Run JavaScript in a confined Code Mode runtime to orchestrate tool calls and compose their results.",
  "Imports, direct filesystem access, and timers are unavailable. Do not use `fetch`; all external access goes through `tools`.",
  "Within `{ code }`, the only callable tools are those explicitly listed in the Code Mode catalog instructions or returned by `search`. Inside `{ code }`, ignore tools shown outside the Code Mode catalog. They are not available in the Code Mode runtime.",
  'Call tools through `tools` using only exact paths and signatures from the catalog. Do not infer or normalize tool names; preserve bracket notation such as `tools.<namespace>["tool-name"](input)`.',
  "Prefer an explicit `return`; if omitted, the final top-level expression becomes the result.",
  "Await every call whose completion matters; pending calls are interrupted when execution ends. Run independent calls concurrently with `Promise.all`.",
].join("\n")

export const create = (
  registrations: ReadonlyMap<string, Info>,
  executeTool: (name: string, tool: Info, input: unknown, context: Context) => Effect.Effect<Result, Error>,
) => {
  return {
    name: "execute",
    description,
    input: CodeMode.Input,
    output: ExecuteOutput,
    execute: ({ code }, context) =>
      Effect.gen(function* () {
        const callIndex = yield* Ref.make(0)
        const files = yield* Ref.make<Array<CollectedFiles>>([])
        const calls = yield* Ref.make<Array<ExecuteCall>>([])
        const lock = Semaphore.makeUnsafe(1)
        const updateCalls = (update: (items: Array<ExecuteCall>) => Array<ExecuteCall>) =>
          lock.withPermit(
            Ref.updateAndGet(calls, update).pipe(Effect.flatMap((toolCalls) => context.progress({ toolCalls }))),
          )
        const result = yield* runtime(
          registrations,
          (name, tool, input) =>
            Effect.gen(function* () {
              const index = yield* Ref.getAndUpdate(callIndex, (index) => index + 1)
              const executed = yield* executeTool(name, tool, input, context)
              const content =
                typeof executed.content === "string"
                  ? [{ type: "text" as const, text: executed.content }]
                  : (executed.content ?? [])
              const outputFileParts = outputFiles(content)
              if (outputFileParts.length > 0)
                yield* Ref.update(files, (items) => [...items, { index, files: outputFileParts }])
              if (executed.output !== undefined) return executed.output
              const text = content.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("\n")
              return text === "" ? null : text
            }),
          {
            onToolCallStart: ({ index, name, input }) => {
              const shown = displayInput(input)
              return updateCalls((items) => {
                const next = [...items]
                next[index] = { tool: name, status: "running", ...(shown ? { input: shown } : {}) }
                return next
              })
            },
            onToolCallEnd: ({ index, name, input, outcome }) => {
              const shown = displayInput(input)
              return updateCalls((items) => {
                const next = [...items]
                next[index] = {
                  ...(items[index] ?? { tool: name, ...(shown ? { input: shown } : {}) }),
                  status: outcome === "success" ? "completed" : "error",
                }
                return next
              })
            },
          },
        ).execute(code)
        const toolCalls = yield* Ref.get(calls)
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
        const content: Array<Content> = [
          { type: "text", text: value.output },
          ...value.files.map((file) => ({
            type: "file" as const,
            uri: `data:${file.mime};base64,${file.data}`,
            mime: file.mime,
            ...(file.name === undefined ? {} : { name: file.name }),
          })),
        ]
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
  } satisfies Info
}

export const catalog = (registrations: ReadonlyMap<string, Info>) => {
  const pinned = new Set(
    Array.from(registrations.values())
      .filter((registration) => registration.options?.pinned === true)
      .map(qualifiedName),
  )
  return runtime(registrations, () => Effect.fail(toolError("Execute context is unavailable")))
    .catalog()
    .map((entry) => ({ ...entry, pinned: pinned.has(entry.path) }))
}

function runtime(
  registrations: ReadonlyMap<string, Info>,
  executeTool: (name: string, tool: Info, input: unknown) => Effect.Effect<unknown, unknown>,
  hooks?: CodeMode.ToolCallHooks,
) {
  const tools: Record<string, Tool.Tool<never>> = {}
  for (const [name, registration] of registrations) {
    const child = definition(registration)
    const path = qualifiedName(registration)
    tools[path] = Tool.make({
      description: child.description,
      input: child.inputSchema,
      output: child.outputSchema ?? Schema.NullOr(Schema.String),
      execute: (input) => executeTool(name, registration, input),
    })
  }
  return CodeMode.make<typeof tools>({ tools, ...hooks })
}

function qualifiedName(registration: Info) {
  const normalized = normalizedName(registration)
  if (registration.options?.namespace === undefined) return normalized
  return `${registration.options.namespace}.${normalized}`
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

function outputFiles(content: ReadonlyArray<Content>): Array<typeof ExecuteFile.Type> {
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
