import { Tool } from "@/tool/tool"
import { EffectBridge } from "@/effect/bridge"
import type { Tool as AITool } from "ai"
import { Effect, Schema } from "effect"

export const CODE_MODE_TOOL = "execute"

export const Parameters = Schema.Struct({
  code: Schema.String.annotate({
    description: "JavaScript to run. Call tools as `await tools.<name>(args)` and `return` the final value.",
  }),
})

type Metadata = {
  toolCalls: string[]
  error?: boolean
}

// `new Function`/`AsyncFunction` is not on the global scope, so reach it via the
// prototype of an async function literal. The body may use top-level `await` and `return`.
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor as {
  new (...args: string[]): (...args: unknown[]) => Promise<unknown>
}

function describe(mcpTools: Record<string, AITool>) {
  const names = Object.keys(mcpTools).sort((a, b) => a.localeCompare(b))
  return [
    "Execute JavaScript with access to connected MCP tools.",
    "Each tool is callable as `await tools.<name>(args)`; `return` the final value.",
    names.length > 0 ? `Available tools: ${names.join(", ")}` : "No MCP tools are currently connected.",
  ].join("\n")
}

/**
 * Reduce an MCP tool result to the value the program should see: structured
 * content when present, otherwise the joined text blocks, otherwise the raw
 * result. Mirrors how the model-facing output is derived elsewhere.
 */
export function toolResultValue(result: unknown): unknown {
  if (result === null || typeof result !== "object") return result
  const record = result as { structuredContent?: unknown; content?: unknown }
  if (record.structuredContent !== undefined && record.structuredContent !== null) return record.structuredContent
  if (Array.isArray(record.content)) {
    const text = record.content
      .filter((item): item is { type: "text"; text: string } => item?.type === "text" && typeof item.text === "string")
      .map((item) => item.text)
      .join("\n")
    if (text.length > 0) return text
    return record.content
  }
  return result
}

/** Coerce the program's return value to model-facing text without ever failing on shape. */
export function formatValue(value: unknown): string {
  if (typeof value === "string") return value
  if (value === undefined) return "undefined"
  try {
    return JSON.stringify(value, null, 2) ?? String(value)
  } catch {
    return String(value)
  }
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === "string") return error
  try {
    return JSON.stringify(error) ?? String(error)
  } catch {
    return String(error)
  }
}

export function define(mcpTools: Record<string, AITool>) {
  return Tool.define(
    CODE_MODE_TOOL,
    Effect.succeed<Tool.DefWithoutID<typeof Parameters, Metadata>>({
      description: describe(mcpTools),
      parameters: Parameters,
      execute: Effect.fn("CodeMode.execute")(function* (params, ctx) {
        const run = yield* EffectBridge.make()
        const calls: string[] = []

        // Each `tools.<name>(args)` call runs the native MCP tool through the
        // permission gate, so approving `execute` does not approve every child call.
        const invoke = (name: string, tool: AITool, args: unknown) =>
          Effect.gen(function* () {
            yield* ctx.ask({ permission: name, metadata: {}, patterns: ["*"], always: ["*"] })
            const result = yield* Effect.promise(() =>
              Promise.resolve(
                tool.execute!(args ?? {}, {
                  toolCallId: ctx.callID ?? name,
                  abortSignal: ctx.abort,
                  messages: [],
                }),
              ),
            )
            return toolResultValue(result)
          })

        const tools = new Proxy(Object.create(null) as Record<string, unknown>, {
          get(_target, prop) {
            if (typeof prop !== "string" || prop === "then") return undefined
            const tool = mcpTools[prop]
            if (!tool || !tool.execute) {
              return () => {
                throw new Error(
                  `Unknown tool '${prop}'. Available tools: ${Object.keys(mcpTools).join(", ") || "(none)"}`,
                )
              }
            }
            return (args: unknown) => {
              calls.push(prop)
              return run.promise(invoke(prop, tool, args))
            }
          },
        })

        return yield* Effect.tryPromise({
          try: () => new AsyncFunction("tools", params.code)(tools),
          catch: (error) => error,
        }).pipe(
          Effect.map(
            (value) =>
              ({
                title: "Code mode",
                metadata: { toolCalls: calls },
                output: formatValue(value),
              }) satisfies Tool.ExecuteResult<Metadata>,
          ),
          Effect.catch((error) =>
            Effect.succeed({
              title: "Code mode",
              metadata: { toolCalls: calls, error: true },
              output: errorMessage(error),
            } satisfies Tool.ExecuteResult<Metadata>),
          ),
        )
      }),
    }),
  )
}
