import { Tool } from "@/tool/tool"
import { EffectBridge } from "@/effect/bridge"
import { asSchema, type Tool as AITool, type JSONSchema7 } from "ai"
import { Effect, Schema } from "effect"

export const CODE_MODE_TOOL = "execute"

export const Parameters = Schema.Struct({
  code: Schema.String.annotate({
    description: "JavaScript to run. Discover tools with `tools.search`/`tools.describe`, call them, and `return` the final value.",
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
const SEARCH = "search"
const DESCRIBE = "describe"

type CatalogEntry = { path: string; key: string; server: string; local: string; description: string; tool: AITool }

const firstLine = (text: string | undefined) => (text ?? "").split("\n", 1)[0]!.trim()
const brief = (text: string | undefined, max = 120) => {
  const line = firstLine(text)
  return line.length > max ? line.slice(0, max - 1) + "…" : line
}

/** Re-join accessed segments into the flat catalog key (`server_tool`). The
 *  server/tool split is cosmetic, so both `tools.a.b` and `tools["a.b"]` resolve. */
const toKey = (segments: readonly string[]) => segments.join("_").replaceAll(".", "_")

/**
 * Group the flat `server_tool` catalog into per-server namespaces. `servers` are
 * the sanitized MCP client names; the longest matching prefix wins so a server
 * named `a_b` beats `a` for the key `a_b_tool`.
 */
export function groupByServer(mcpTools: Record<string, AITool>, servers: readonly string[]): Map<string, CatalogEntry[]> {
  const byLongest = [...servers].sort((a, b) => b.length - a.length)
  const groups = new Map<string, CatalogEntry[]>()
  for (const key of Object.keys(mcpTools).sort((a, b) => a.localeCompare(b))) {
    const server = byLongest.find((name) => key.startsWith(name + "_")) ?? key.slice(0, key.indexOf("_"))
    const local = server && key.startsWith(server + "_") ? key.slice(server.length + 1) : key
    const entry: CatalogEntry = {
      path: `${server}.${local}`,
      key,
      server,
      local,
      description: mcpTools[key]!.description ?? "",
      tool: mcpTools[key]!,
    }
    groups.set(server, [...(groups.get(server) ?? []), entry])
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

const signatureFor = (entry: CatalogEntry) =>
  `tools${access(entry.server)}${access(entry.local)}(${inputHint(entry.tool)})`

/**
 * The execute tool description: the calling convention, the discovery API, and a
 * list of namespaces only — never the full tool catalog. Per-tool signatures are
 * fetched on demand with `tools.describe` so the prompt stays small.
 */
export function describe(groups: Map<string, CatalogEntry[]>): string {
  const lines = [
    "Execute JavaScript with access to connected MCP tools, grouped into namespaces (one per MCP server).",
    "",
    "Discover tools inside your program, then call them:",
    "- `await tools.search(query, { namespace?, limit? })` -> `{ items: [{ path, description }], total }`",
    "- `await tools.describe(path)` -> `{ path, description, signature, inputSchema }`",
    "- Call a tool by its path: `await tools.<server>.<tool>(input)` or `await tools[path](input)`. Each returns a Promise.",
    "",
    "Compose multiple calls in one program and `return` the final value — intermediate results stay in the sandbox and never re-enter the conversation. Use `tools.search('', { namespace })` to list a namespace's tools.",
  ]
  if (groups.size === 0) {
    lines.push("", "No MCP servers are currently connected.")
    return lines.join("\n")
  }
  lines.push("", "Available namespaces:")
  for (const [server, entries] of [...groups].sort(([a], [b]) => a.localeCompare(b))) {
    lines.push(`- ${server} (${entries.length} tool${entries.length === 1 ? "" : "s"})`)
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
  const catalog: CatalogEntry[] = [...groups.values()].flat()
  const byKey = new Map(catalog.map((entry) => [entry.key, entry] as const))

  const search = (query: unknown, options: unknown) => {
    const q = (typeof query === "string" ? query : "").toLowerCase()
    const opts = (options ?? {}) as { namespace?: unknown; limit?: unknown }
    const namespace = typeof opts.namespace === "string" ? opts.namespace : undefined
    const limit = typeof opts.limit === "number" && opts.limit > 0 ? Math.floor(opts.limit) : 25
    const matched = catalog
      .filter((entry) => (namespace ? entry.server === namespace : true))
      .filter((entry) => (q ? `${entry.path} ${entry.description}`.toLowerCase().includes(q) : true))
    return {
      items: matched.slice(0, limit).map((entry) => ({ path: entry.path, description: brief(entry.description) })),
      total: matched.length,
    }
  }

  const describeTool = (path: unknown) => {
    if (typeof path !== "string") return { error: { code: "invalid_path", message: "describe expects a tool path string." } }
    const entry = byKey.get(toKey([path]))
    if (!entry) {
      const segment = path.split(/[._]/)[0] ?? ""
      const suggestions = catalog
        .filter((item) => item.server === segment || item.path.includes(path))
        .slice(0, 5)
        .map((item) => item.path)
      return { error: { code: "tool_not_found", message: `No tool at '${path}'.`, suggestions } }
    }
    let inputSchema: unknown
    try {
      inputSchema = asSchema(entry.tool.inputSchema).jsonSchema
    } catch {
      inputSchema = undefined
    }
    return { path: entry.path, description: entry.description, signature: signatureFor(entry), inputSchema }
  }

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

        // Recursive path-accumulating proxy: `tools.<server>.<tool>(args)` and
        // `tools[path](args)` both resolve to a flat catalog key, while the reserved
        // top-level `tools.search`/`tools.describe` provide on-demand discovery.
        const make = (segments: readonly string[]): unknown =>
          new Proxy(function () {} as object, {
            get(_target, prop) {
              if (typeof prop !== "string" || prop === "then") return undefined
              return make([...segments, prop])
            },
            apply(_target, _thisArg, args: unknown[]) {
              if (segments.length === 1 && segments[0] === SEARCH) return search(args[0], args[1])
              if (segments.length === 1 && segments[0] === DESCRIBE) return describeTool(args[0])
              const key = toKey(segments)
              const tool = mcpTools[key]
              if (!tool || !tool.execute) {
                throw new Error(
                  `Unknown tool 'tools.${segments.join(".")}'. Use tools.search(query) to discover available tools.`,
                )
              }
              calls.push(key)
              return run.promise(invoke(key, tool, args[0]))
            },
          })

        const tools = make([])

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
