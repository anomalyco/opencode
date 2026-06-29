import { Tool } from "@/tool/tool"
import { EffectBridge } from "@/effect/bridge"
import { asSchema, type Tool as AITool, type JSONSchema7 } from "ai"
import { Effect, Schema } from "effect"

export const CODE_MODE_TOOL = "execute"

export const Parameters = Schema.Struct({
  code: Schema.String.annotate({
    description: "JavaScript to run. Call tools as `await tools.<server>.<tool>(input)` and `return` the final value.",
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

const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/

type NamespacedTool = { local: string; key: string; tool: AITool }

/**
 * Group the flat `server_tool` catalog into per-server namespaces for display.
 * `servers` are the sanitized MCP client names; the longest matching prefix wins
 * so a server named `a_b` is preferred over `a` for the key `a_b_tool`. Routing
 * never depends on this split — it re-joins `${server}_${local}` back to the key.
 */
export function groupByServer(mcpTools: Record<string, AITool>, servers: readonly string[]): Map<string, NamespacedTool[]> {
  const byLongest = [...servers].sort((a, b) => b.length - a.length)
  const groups = new Map<string, NamespacedTool[]>()
  for (const key of Object.keys(mcpTools).sort((a, b) => a.localeCompare(b))) {
    const server = byLongest.find((name) => key.startsWith(name + "_")) ?? key.slice(0, key.indexOf("_"))
    const local = server && key.startsWith(server + "_") ? key.slice(server.length + 1) : key
    const entry = groups.get(server) ?? []
    entry.push({ local, key, tool: mcpTools[key]! })
    groups.set(server, entry)
  }
  return groups
}

const access = (segment: string) => (IDENTIFIER.test(segment) ? `.${segment}` : `[${JSON.stringify(segment)}]`)

function jsonType(def: JSONSchema7 | boolean | undefined): string {
  if (!def || typeof def === "boolean") return "any"
  if (Array.isArray(def.enum)) return def.enum.map((value) => JSON.stringify(value)).join(" | ")
  const type = Array.isArray(def.type) ? def.type[0] : def.type
  switch (type) {
    case "integer":
      return "number"
    case "array":
      return "any[]"
    case undefined:
      return "any"
    default:
      return type
  }
}

function inputHint(tool: AITool): string {
  try {
    const schema = asSchema(tool.inputSchema).jsonSchema as JSONSchema7 | undefined
    const props = schema?.properties
    if (!props || typeof props !== "object") return "input"
    const required = new Set(Array.isArray(schema?.required) ? schema.required : [])
    const fields = Object.entries(props).map(
      ([name, def]) => `${name}${required.has(name) ? "" : "?"}: ${jsonType(def as JSONSchema7)}`,
    )
    return fields.length > 0 ? `{ ${fields.join("; ")} }` : "{}"
  } catch {
    return "input"
  }
}

const firstLine = (text: string | undefined) => (text ?? "").split("\n", 1)[0]!.trim()

export function describe(groups: Map<string, NamespacedTool[]>): string {
  const lines = [
    "Execute JavaScript with access to connected MCP tools.",
    "Every connected MCP server is a namespace on `tools`. Call a tool with `await tools.<server>.<tool>(input)`; each returns a Promise.",
    "Compose multiple calls in one program and `return` the final value — intermediate results stay in the sandbox and never re-enter the conversation.",
  ]
  if (groups.size === 0) {
    lines.push("", "No MCP servers are currently connected.")
    return lines.join("\n")
  }
  lines.push("", "Available namespaces:")
  for (const [server, tools] of [...groups].sort(([a], [b]) => a.localeCompare(b))) {
    lines.push("", `// ${server}`)
    for (const { local, tool } of tools) {
      const signature = `tools${access(server)}${access(local)}(${inputHint(tool)})`
      const summary = firstLine(tool.description)
      lines.push(summary ? `${signature}  // ${summary}` : signature)
    }
  }
  return lines.join("\n")
}

/**
 * Reduce an MCP tool result to the value the program should see: structured
 * content when present, otherwise the joined text blocks, otherwise the raw
 * result.
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

export function define(mcpTools: Record<string, AITool>, servers: readonly string[]) {
  const groups = groupByServer(mcpTools, servers)
  return Tool.define(
    CODE_MODE_TOOL,
    Effect.succeed<Tool.DefWithoutID<typeof Parameters, Metadata>>({
      description: describe(groups),
      parameters: Parameters,
      execute: Effect.fn("CodeMode.execute")(function* (params, ctx) {
        const run = yield* EffectBridge.make()
        const calls: string[] = []

        // Each tool call runs the native MCP tool through the permission gate, so
        // approving `execute` does not approve every child call.
        const invoke = (key: string, tool: AITool, args: unknown) =>
          Effect.gen(function* () {
            yield* ctx.ask({ permission: key, metadata: {}, patterns: ["*"], always: ["*"] })
            const result = yield* Effect.promise(() =>
              Promise.resolve(
                tool.execute!(args ?? {}, {
                  toolCallId: ctx.callID ?? key,
                  abortSignal: ctx.abort,
                  messages: [],
                }),
              ),
            )
            return toolResultValue(result)
          })

        // `tools.<server>.<tool>(args)` — the server/tool split is cosmetic; routing
        // re-joins `${server}_${tool}` back into the original flat catalog key.
        const namespace = (server: string) =>
          new Proxy(Object.create(null) as Record<string, unknown>, {
            get(_target, prop) {
              if (typeof prop !== "string" || prop === "then") return undefined
              const key = `${server}_${prop}`
              const tool = mcpTools[key]
              if (!tool || !tool.execute) {
                return () => {
                  throw new Error(`Unknown tool 'tools.${server}.${prop}'. Available: ${Object.keys(mcpTools).join(", ")}`)
                }
              }
              return (args: unknown) => {
                calls.push(key)
                return run.promise(invoke(key, tool, args))
              }
            },
          })

        const tools = new Proxy(Object.create(null) as Record<string, unknown>, {
          get(_target, prop) {
            if (typeof prop !== "string" || prop === "then") return undefined
            return namespace(prop)
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
