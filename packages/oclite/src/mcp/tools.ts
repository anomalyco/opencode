// MCP tool → OcliteTool (ARCHITECTURE §12 Tools): `mcp__<server>__<tool>` wire names, `[server]` descriptions,
// readOnlyHint, per-server timeouts reset by progress, MCP content → text, the deferred-profile `tool_search`
// meta-tool, and resource text for @-mentions (large bodies go to a file and are attached by path).
import { chmod, mkdir, writeFile } from "fs/promises"
import path from "path"
import { Effect } from "effect"
import { type ContentPart, Tool, ToolFailure } from "@opencode-ai/llm"
import type { McpShape, McpStatus, OcliteTool, Profile, ProfileName, ToolSet } from "../contract"
import { dataDir } from "../util/paths"
import { redactText } from "../util/redact"

// Structural subsets of the SDK result types, so this module never loads the SDK.
export interface McpToolDef {
  name: string
  description?: string
  inputSchema: { type: "object"; properties?: Record<string, object>; [key: string]: unknown }
  annotations?: { readOnlyHint?: boolean }
}
type Content = { type: string; text?: string; data?: string; mimeType?: string; uri?: string; resource?: Resource }
type Resource = { uri: string; text?: string; blob?: string; mimeType?: string }
export interface McpCallResult { content?: Content[]; structuredContent?: unknown; isError?: boolean }

export const DEFAULT_TIMEOUT = 30_000
/** Resource text above this is written to a file and attached by path (SPEC context engineering #4). */
export const INLINE_RESOURCE_BYTES = 8192

export function sanitize(value: string) {
  return value.replace(/[^A-Za-z0-9_-]/g, "_")
}

/** Over 64 chars: the first 55 + `_` + 8 hex of the sha1 of the full name, so long names stay unique. */
export function wireName(server: string, tool: string) {
  const name = `mcp__${sanitize(server)}__${sanitize(tool)}`
  if (name.length <= 64) return name
  return `${name.slice(0, 55)}_${new Bun.CryptoHasher("sha1").update(name).digest("hex").slice(0, 8)}`
}

export function toTool(input: {
  server: string
  def: McpToolDef
  timeoutMs: number
  call: (args: Record<string, unknown>, signal: AbortSignal) => Promise<McpCallResult>
}): OcliteTool {
  const name = wireName(input.server, input.def.name)
  const schema = input.def.inputSchema
  return {
    name,
    tool: Tool.make({
      description: `[${input.server}] ${input.def.description ?? input.def.name}`,
      jsonSchema: { ...schema, type: "object", properties: schema.properties ?? {} },
      execute: (args) =>
        Effect.tryPromise({
          try: (signal) => input.call(isRecord(args) ? args : {}, signal),
          catch: (error) => callFailure(error, input.timeoutMs),
        }).pipe(
          Effect.flatMap((result) =>
            result.isError
              ? Effect.fail(new ToolFailure({ message: toText(result) || "MCP tool returned an error" }))
              : Effect.succeed(toText(result)),
          ),
        ),
    }),
    // `always` is a pattern of this tool's own permission, so an "always" reply approves this one tool.
    access: () => ({ permission: name, patterns: ["*"], always: ["*"] }),
    readOnly: input.def.annotations?.readOnlyHint === true,
    // The SDK enforces the per-server timeout (reset on progress); this outer bound only stops endless progress.
    timeoutMs: input.timeoutMs * 10,
    summarize: (args) => summary(name, args),
  }
}

/** Text, embedded resources and structuredContent become text; binary parts become a one-line placeholder. */
export function toText(result: McpCallResult) {
  const parts = (result.content ?? []).map((part) => {
    if (part.type === "text") return part.text ?? ""
    if (part.type === "resource" && part.resource) return resourceText(part.resource)
    if (part.type === "resource_link") return `[resource ${part.uri}]`
    return `[${part.type}${part.mimeType ? ` ${part.mimeType}` : ""}, ${part.data?.length ?? 0} base64 chars]`
  })
  if (!parts.length && result.structuredContent != null) return JSON.stringify(result.structuredContent)
  return parts.join("\n")
}

function resourceText(item: Resource) {
  return item.text ?? `[binary resource ${item.uri}${item.mimeType ? ` (${item.mimeType})` : ""}, ${item.blob?.length ?? 0} base64 chars]`
}

/** readResource contents → attachment text; over 8 KB the body is written under tool-output and only the path is inline. */
export async function resourceAttachment(server: string, uri: string, contents: readonly Resource[]) {
  const text = contents.map(resourceText).join("\n")
  const bytes = Buffer.byteLength(text)
  if (bytes <= INLINE_RESOURCE_BYTES) return { text: `<resource server="${server}" uri="${uri}">\n${text}\n</resource>` }
  // Under tool-output (the default ruleset already allows reading it back), redacted, owner-only (0700 dir, 0600 file).
  const dir = path.join(dataDir(), "tool-output", "mcp")
  await mkdir(dir, { recursive: true, mode: 0o700 })
  await chmod(dir, 0o700)
  const file = path.join(dir, `${new Bun.CryptoHasher("sha1").update(`${server}\0${uri}`).digest("hex").slice(0, 16)}.txt`)
  await writeFile(file, redactText(text), { mode: 0o600 })
  await chmod(file, 0o600)
  return { path: file, text: `<resource server="${server}" uri="${uri}" path="${file}" bytes="${bytes}">Too large to inline; read it from the path.</resource>` }
}

export function promptParts(messages: ReadonlyArray<{ content: Content }>): ContentPart[] {
  return messages.map((message) => ({ type: "text", text: message.content.type === "text" ? (message.content.text ?? "") : toText({ content: [message.content] }) }))
}

// Hand-written and minimal: this schema is part of every deferred-profile request (local ≤ 1200, local-min ≤ 600 tok).
const SEARCH_SCHEMA = { type: "object", properties: { query: { type: "string" }, limit: { type: "integer" } }, required: ["query"] } as const

/**
 * Deferred profiles send only this tool. Matches join the next request through `activate`, which also persists
 * `tools_activated` and returns instructions of servers whose tools are new to the run.
 */
export function searchTool(input: {
  search: (query: string, limit: number) => Effect.Effect<ReadonlyArray<{ name: string; description: string }>>
  maxChars: number | undefined
  activate: (names: string[]) => Effect.Effect<string[]>
}): OcliteTool {
  return {
    name: "tool_search",
    tool: Tool.make({
      description: "Find MCP tools by keyword (limit 1-10, default 5); matches become callable next turn.",
      jsonSchema: SEARCH_SCHEMA,
      execute: (raw) =>
        Effect.gen(function* () {
          if (!isRecord(raw) || typeof raw.query !== "string") return yield* new ToolFailure({ message: "Invalid tool input: query must be a string" })
          const found = yield* input.search(raw.query, Math.min(10, Math.max(1, Number(raw.limit) || 5)))
          if (!found.length) return `No MCP tools match "${raw.query}".`
          const instructions = yield* input.activate(found.map((item) => item.name))
          return [...found.map((item) => `${item.name} — ${item.description.slice(0, input.maxChars)}`), ...instructions].join("\n")
        }),
    }),
    access: () => ({ permission: "tool_search", patterns: ["*"] }),
    readOnly: true,
    timeoutMs: DEFAULT_TIMEOUT,
    summarize: (params) => summary("tool_search", params),
  }
}

/** Deferred profiles add `tool_search`; the registry keeps `mcp__*` out of the request until activated. */
export function forProfile(profile: Profile, tools: readonly OcliteTool[], search: () => OcliteTool) {
  return !tools.length ? [] : profile.mcp === "deferred" ? [...tools, search()] : [...tools]
}

/** Keyword score: each query word found in the name counts 2, in the description 1. */
export function rank(query: string, tools: ReadonlyArray<{ name: string; description: string }>, limit: number) {
  const words = query.toLowerCase().split(/[\s,]+/).filter(Boolean)
  return tools
    .map((item) => ({ item, score: words.reduce((sum, word) => sum + (item.name.toLowerCase().includes(word) ? 2 : 0) + (item.description.toLowerCase().includes(word) ? 1 : 0), 0) }))
    .filter((entry) => entry.score > 0)
    .toSorted((a, b) => b.score - a.score || a.item.name.localeCompare(b.item.name))
    .slice(0, Math.min(limit, 10))
    .map((entry) => entry.item)
}

/** One status line: `fixture: connected (6 tools)`, `api: needs_auth — …`. */
export function statusText(status: McpStatus) {
  return `${status.name}: ${status.status}${status.status === "connected" ? ` (${status.tools} tools)` : ""}${status.error ? ` — ${status.error}` : ""}`
}

function callFailure(error: unknown, timeoutMs: number) {
  // -32001 is the SDK's RequestTimeout (no progress within the timeout).
  if (isRecord(error) && error.code === -32001)
    return new ToolFailure({ message: `timed out after ${timeoutMs / 1000} s`, error: { status: "timeout" }, metadata: { status: "timeout" } })
  return new ToolFailure({ message: `MCP error: ${error instanceof Error ? error.message : String(error)}` })
}

function summary(name: string, args: unknown) {
  const first = isRecord(args) ? Object.values(args).find((value) => typeof value === "string") : undefined
  return first ? `${name} ${String(first).split("\n")[0]!.slice(0, 80)}` : name
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

/**
 * The MCP part of a run (shared with `debug prompt`): the extra tools for registry.build (every MCP tool, or only
 * tool_search in deferred profiles), read-only names for the ruleset, and `bind`, which re-applies persisted
 * activations and returns server instructions for the system prompt. Servers first reached through tool_search
 * get their instructions in that tool's result instead, so the system prompt stays byte-stable for the run.
 */
export function mcpForRun(
  mcp: McpShape,
  profile: Profile,
  persist: (names: string[]) => Effect.Effect<void>,
  notice: (key: string, message: string) => Effect.Effect<void>,
) {
  return Effect.gen(function* () {
    const all = yield* mcp.tools()
    const bound: { tools?: ToolSet } = {}
    const shown = new Set<string>()
    const cap = MCP_INSTRUCTIONS_CAP[profile.name]
    // Each server's instructions once per run, cut to the profile cap (a few KB would break the local budgets).
    const fresh = (texts: string[]) =>
      Effect.forEach(texts.filter((text) => !shown.has(text) && !!shown.add(text)), (text) => {
        if (text.length <= cap) return Effect.succeed(text)
        const head = text.split("\n")[0]!
        return notice(`mcp-instructions:${profile.name}:${head}`, `${head.replace(/:$/, "")} cut to ${cap} chars (${profile.name})`).pipe(
          Effect.as(`${text.slice(0, cap)}\n…[truncated]`),
        )
      })
    const search = () =>
      searchTool({
        search: mcp.search,
        maxChars: profile.descriptionMaxChars,
        activate: (names) =>
          Effect.gen(function* () {
            yield* bound.tools?.activate(names) ?? Effect.void
            yield* persist(names)
            return yield* fresh(yield* mcp.instructions(names))
          }),
      })
    return {
      extra: forProfile(profile, all, search),
      readOnly: all.filter((tool) => tool.readOnly).map((tool) => tool.name),
      bind: (tools: ToolSet, activated: readonly string[]) =>
        Effect.gen(function* () {
          bound.tools = tools
          if (activated.length) yield* tools.activate([...activated])
          const requested = profile.mcp === "deferred" ? activated : all.map((tool) => tool.name)
          return yield* fresh(yield* mcp.instructions(requested.filter((name) => name in tools.tools)))
        }),
    }
  })
}

const MCP_INSTRUCTIONS_CAP: Record<ProfileName, number> = { default: 2000, local: 600, "local-min": 300 }
