import { Tool } from "@/tool/tool"
import { asSchema, type Tool as AITool, type JSONSchema7 } from "ai"
import type { Tool as MCPToolDef } from "@modelcontextprotocol/sdk/types.js"
import { Effect, Schema } from "effect"
import { Rune } from "./rune/rune"
import type { ExecutionLimits } from "./rune/rune"
import type { HostTools } from "./rune/tool-runtime"

export const CODE_MODE_TOOL = "execute"

/**
 * Execution limits for the Rune interpreter. `maxDataBytes` is raised well above
 * the Rune default (256KB) because code mode forwards base64 media attachments,
 * and the timeout matches the default MCP request timeout.
 */
const CODE_LIMITS: ExecutionLimits = {
  maxDataBytes: 10_000_000,
  timeoutMs: 30_000,
}

export const Parameters = Schema.Struct({
  code: Schema.String.annotate({
    description: "JavaScript to run. Discover tools with `tools.$rune.search`/`tools.$rune.describe`, call them, and `return` the final value.",
  }),
})

/** One child tool call, surfaced live so the UI can render a per-call line that
 *  updates as the program runs. `tool` is the dotted path (e.g. `github.create_issue`). */
export type CallEntry = { tool: string; status: "running" | "completed" | "error"; input?: Record<string, unknown> }

type Metadata = {
  toolCalls: CallEntry[]
  error?: boolean
}

/**
 * A real attachment: identical to a session `FilePart` (minus the ids) and carrying
 * the actual bytes (`url`, often a base64 `data:` URL), so it lowers 1:1 into
 * `Tool.ExecuteResult.attachments`. This never crosses into the sandbox — the program
 * only ever sees the opaque {@link AttachmentHandle}.
 */
export type Attachment = NonNullable<Tool.ExecuteResult["attachments"]>[number]

/**
 * The opaque, model-facing view of an attachment: metadata only, no bytes. A program
 * can inspect `mime`/`filename`/`bytes`, propagate the handle (return it to show the
 * user) or drop it, but can NOT read or leak the contents — so a stray `return`/log
 * can never dump a base64 blob back into the conversation.
 */
export type AttachmentHandle = { type: "file"; id: string; mime: string; filename?: string; bytes?: number }

/** The envelope every tool call resolves to, and the shape a program should `return`. */
export type Envelope = { result: unknown; attachments?: AttachmentHandle[] }

const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/
const SEARCH = "search"
const DESCRIBE = "describe"
// The runtime's own capabilities live under `tools.$rune.*`, separated from the
// MCP server namespaces. `$` can never appear in a sanitized server name, so this
// namespace is collision-proof.
const RUNE_NS = "$rune"

type CatalogEntry = {
  path: string
  key: string
  server: string
  local: string
  description: string
  tool: AITool
  outputSchema?: JSONSchema7
}

const firstLine = (text: string | undefined) => (text ?? "").split("\n", 1)[0]!.trim()
const brief = (text: string | undefined, max = 120) => {
  const line = firstLine(text)
  return line.length > max ? line.slice(0, max - 1) + "…" : line
}

function displayInput(input: unknown): Record<string, unknown> | undefined {
  if (input === null || input === undefined) return
  if (typeof input === "object" && !Array.isArray(input)) {
    const value = input as Record<string, unknown>
    if (Object.keys(value).length > 0) return value
    return
  }
  return { input }
}

/** Re-join accessed segments into the flat catalog key (`server_tool`). The
 *  server/tool split is cosmetic, so `tools.a.b`, `tools["a.b"]`, `a/b`, and `a_b`
 *  all resolve to the same key — the model never has to guess the separator. */
const toKey = (segments: readonly string[]) => segments.join("_").replace(/[./]/g, "_")

/**
 * Group the flat `server_tool` catalog into per-server namespaces. `servers` are
 * the sanitized MCP client names; the longest matching prefix wins so a server
 * named `a_b` beats `a` for the key `a_b_tool`. `mcpDefs` carries the raw MCP
 * definitions (keyed identically) so each entry retains its `outputSchema`.
 */
export function groupByServer(
  mcpTools: Record<string, AITool>,
  servers: readonly string[],
  mcpDefs: Record<string, MCPToolDef> = {},
): Map<string, CatalogEntry[]> {
  const byLongest = [...servers].sort((a, b) => b.length - a.length)
  const groups = new Map<string, CatalogEntry[]>()
  for (const key of Object.keys(mcpTools).sort((a, b) => a.localeCompare(b))) {
    const server = byLongest.find((name) => key.startsWith(name + "_")) ?? key.slice(0, key.indexOf("_"))
    const local = server && key.startsWith(server + "_") ? key.slice(server.length + 1) : key
    const output = mcpDefs[key]?.outputSchema as JSONSchema7 | undefined
    const entry: CatalogEntry = {
      path: `${server}.${local}`,
      key,
      server,
      local,
      description: mcpTools[key]!.description ?? "",
      tool: mcpTools[key]!,
      outputSchema: output,
    }
    groups.set(server, [...(groups.get(server) ?? []), entry])
  }
  return groups
}

const access = (segment: string) => (IDENTIFIER.test(segment) ? `.${segment}` : `[${JSON.stringify(segment)}]`)

/** An object property name, bare when it is a valid identifier, else quoted. */
const propKey = (name: string) => (IDENTIFIER.test(name) ? name : JSON.stringify(name))

/** Join type strings into a union, de-duplicating members and preserving order. An
 *  empty set of members (e.g. an empty `enum`/`anyOf`) is `never`, never the empty string. */
const asUnion = (parts: string[]) => {
  const unique = [...new Set(parts)]
  return unique.length > 0 ? unique.join(" | ") : "never"
}

/** Resolve a local JSON-Schema `$ref` (`#/$defs/Foo`) against the document root.
 *  Returns undefined for external or unresolvable refs. */
function resolveRef(ref: string, root: JSONSchema7 | undefined): JSONSchema7 | undefined {
  if (!root || !ref.startsWith("#/")) return undefined
  let node: unknown = root
  for (const raw of ref.slice(2).split("/")) {
    const segment = raw.replace(/~1/g, "/").replace(/~0/g, "~")
    if (!node || typeof node !== "object") return undefined
    node = (node as Record<string, unknown>)[segment]
  }
  return node && typeof node === "object" ? (node as JSONSchema7) : undefined
}

const MAX_DEPTH = 8

/** Options for {@link renderType}. `root` anchors `$ref` resolution (defaults to the
 *  top-level schema); `pretty` switches from a single-line type to an indented,
 *  JSDoc-annotated block used by `describe`. */
export type RenderOptions = { root?: JSONSchema7; pretty?: boolean }

/**
 * Render a JSON Schema as a TypeScript type string for model-facing signatures.
 * Total (never throws — falls back to `any`/`object`) and cycle-safe: local `$ref`s
 * are inlined, self-referential ones collapse to the ref name. Compact by default
 * (single line, no docs); `pretty` produces an indented block with `/** … *\/` docs
 * on described fields. Handles enums, `const`, `anyOf`/`oneOf` unions, `allOf`
 * intersections (the common Pydantic `allOf: [{ $ref }]` shape), nullable `type`
 * arrays, tuples, and `additionalProperties`.
 */
export function renderType(
  def: JSONSchema7 | boolean | undefined,
  options: RenderOptions = {},
  depth = 0,
  seen: ReadonlySet<JSONSchema7> = new Set(),
): string {
  if (!def || typeof def === "boolean") return "any"
  // Absolute recursion ceiling. Object/array recursion increments `depth`, and so do
  // the union/nullable branches below, so this bounds every recursion path — including
  // pure-union structural cycles that the `$ref` `seen` guard cannot see. Keeps the
  // "never throws" contract even for pathological (non-JSON-transport) input.
  if (depth > MAX_DEPTH) return "any"
  const root = options.root ?? def
  const opts: RenderOptions = { ...options, root }

  if (typeof def.$ref === "string") {
    const target = resolveRef(def.$ref, root)
    const name = def.$ref.split("/").pop() || "any"
    if (!target) return "any"
    if (seen.has(target)) return name // recursive type: reference by name rather than loop
    return renderType(target, opts, depth, new Set([...seen, target]))
  }
  if (Array.isArray(def.enum)) return asUnion(def.enum.map((value) => JSON.stringify(value)))
  if (def.const !== undefined) return JSON.stringify(def.const)

  // allOf = intersection. The dominant Pydantic/FastMCP shape is `allOf: [{ $ref }]`
  // with a sibling description/default, so a single member renders as just that member;
  // any base `properties` on `def` itself are intersected in.
  if (Array.isArray(def.allOf) && def.allOf.length > 0) {
    const base = def.properties || def.additionalProperties !== undefined ? renderObject(def, opts, depth, seen) : undefined
    const members = def.allOf.map((member) => renderType(member as JSONSchema7, opts, depth + 1, seen))
    const parts = [...(base ? [base] : []), ...members].filter((part) => part !== "any")
    return parts.length === 0 ? "any" : parts.length === 1 ? parts[0]! : parts.join(" & ")
  }

  // Nullable / multi-type: `["string","null"]` -> `string | null` (don't drop members).
  if (Array.isArray(def.type)) {
    return asUnion(def.type.map((type) => renderType({ ...def, type }, opts, depth + 1, seen)))
  }

  switch (def.type) {
    case "integer":
      return "number"
    case "string":
    case "number":
    case "boolean":
    case "null":
      return def.type
    case "array": {
      const items = Array.isArray(def.items) ? def.items[0] : def.items
      const inner = renderType(items as JSONSchema7 | undefined, opts, depth + 1, seen)
      return /[ |&]/.test(inner) ? `(${inner})[]` : `${inner}[]`
    }
  }

  if (def.type === "object" || def.properties || def.additionalProperties !== undefined) {
    return renderObject(def, opts, depth, seen)
  }

  // anyOf / oneOf union — checked after object handling so a base object paired with a
  // `require one of` anyOf still renders its properties instead of collapsing to a union.
  const union = def.anyOf ?? def.oneOf
  if (Array.isArray(union)) return asUnion(union.map((alt) => renderType(alt as JSONSchema7, opts, depth + 1, seen)))
  return "any"
}

/** Schema constraints that a TypeScript type can't express natively but a model
 *  benefits from, surfaced as JSDoc tags (`@default`, `@format`, `@deprecated`, …). */
function docTags(schema: JSONSchema7 | boolean | undefined): string[] {
  if (!schema || typeof schema === "boolean") return []
  // `deprecated` is a later JSON-Schema draft than the `ai` JSONSchema7 type models.
  const s = schema as JSONSchema7 & { deprecated?: boolean }
  const tags: string[] = []
  if (s.deprecated === true) tags.push("@deprecated")
  if (s.default !== undefined) {
    try {
      tags.push(`@default ${JSON.stringify(s.default)}`)
    } catch {
      // unserializable default: skip rather than emit a broken tag
    }
  }
  if (typeof s.format === "string") tags.push(`@format ${s.format}`)
  if (typeof s.minItems === "number") tags.push(`@minItems ${s.minItems}`)
  if (typeof s.maxItems === "number") tags.push(`@maxItems ${s.maxItems}`)
  return tags
}

/**
 * Format a schema `description` plus `tags` as a JSDoc comment at the given indent,
 * preserving multi-line text (a single line stays `/** … *\/`; multiple lines become a
 * `*`-prefixed block). `*\/` is neutralized so nothing can close the comment early, and
 * blank leading/trailing lines are trimmed. Returns "" (else a trailing newline) so
 * callers can prepend it directly to the field line.
 */
function jsdoc(description: string | undefined, tags: string[], pad: string): string {
  const lines = [...(description ? description.split("\n") : []), ...tags].map((line) =>
    line.replaceAll("*/", "* /").replace(/\s+$/, ""),
  )
  while (lines.length > 0 && lines[0]!.trim() === "") lines.shift()
  while (lines.length > 0 && lines[lines.length - 1]!.trim() === "") lines.pop()
  if (lines.length === 0) return ""
  if (lines.length === 1) return `${pad}/** ${lines[0]} */\n`
  const body = lines.map((line) => `${pad} *${line ? ` ${line}` : ""}`).join("\n")
  return `${pad}/**\n${body}\n${pad} */\n`
}

function renderObject(
  def: JSONSchema7,
  opts: RenderOptions,
  depth: number,
  seen: ReadonlySet<JSONSchema7>,
): string {
  const props = (def.properties ?? {}) as Record<string, JSONSchema7>
  const names = Object.keys(props)
  const additional = def.additionalProperties
  const indexType =
    additional === true ? "any" : additional && typeof additional === "object" ? renderType(additional, opts, depth + 1, seen) : undefined
  if (names.length === 0) return indexType ? `{ [key: string]: ${indexType} }` : "object"
  if (depth >= MAX_DEPTH) return "object"

  const required = new Set(Array.isArray(def.required) ? def.required : [])
  const field = (name: string) => `${propKey(name)}${required.has(name) ? "" : "?"}: ${renderType(props[name], opts, depth + 1, seen)}`

  if (!opts.pretty) {
    const fields = names.map(field)
    if (indexType) fields.push(`[key: string]: ${indexType}`)
    return `{ ${fields.join("; ")} }`
  }

  const pad = "  ".repeat(depth + 1)
  const lines = names.map((name) => `${jsdoc(props[name]?.description, docTags(props[name]), pad)}${pad}${field(name)}`)
  if (indexType) lines.push(`${pad}[key: string]: ${indexType}`)
  return `{\n${lines.join("\n")}\n${"  ".repeat(depth)}}`
}

function inputType(tool: AITool): string {
  try {
    const schema = asSchema(tool.inputSchema).jsonSchema as JSONSchema7 | undefined
    if (!schema?.properties || typeof schema.properties !== "object") return "input"
    return renderType(schema)
  } catch {
    return "input"
  }
}

/** The `T` in `Result<T>`: the structured `outputSchema` (when the MCP server declares
 *  one), else `unknown` — an untyped result has no guaranteed shape and must be inspected,
 *  not assumed. `Result<T>` itself is defined once in the tool description prose. */
const resultType = (outputSchema: JSONSchema7 | undefined) => (outputSchema ? renderType(outputSchema) : "unknown")

/** The full, awaited call type shown by `tools.$rune.describe`. */
const returnType = (outputSchema: JSONSchema7 | undefined) => `Promise<Result<${resultType(outputSchema)}>>`

const signatureFor = (entry: CatalogEntry) =>
  `tools${access(entry.server)}${access(entry.local)}(input: ${inputType(entry.tool)}): ${returnType(entry.outputSchema)}`

/** The directly-callable signature for the inline preview. Unlike the full `describe`
 *  form it drops the uniform `Promise<…>` wrapper (calls are always awaited) but DOES
 *  show the awaited `Result<T>` — so the model sees each tool's return shape without a
 *  discovery round-trip. */
const previewSignature = (entry: CatalogEntry) =>
  `tools${access(entry.server)}${access(entry.local)}(input: ${inputType(entry.tool)}): Result<${resultType(entry.outputSchema)}>`

/**
 * Character budget for the inline signature preview in the tool description. All
 * namespaces are always listed; per-tool call signatures are previewed (cheapest
 * first, server by server) until this many characters are used, after which the
 * remaining namespaces show counts only. This front-loads a directly-callable slice
 * of the catalog — cutting discovery round-trips — without dumping every signature.
 */
const PREVIEW_BUDGET = 2000

/**
 * The execute tool description: the calling convention, the discovery API, and the
 * list of namespaces. A budgeted preview of per-tool call signatures is inlined; the
 * full typed signature + schemas are fetched on demand with `tools.$rune.describe`,
 * and any tool not previewed must be found via `tools.$rune.search` first.
 */
export function describe(groups: Map<string, CatalogEntry[]>): string {
  const lines = [
    "Execute JavaScript with access to connected MCP tools, grouped into namespaces (one per MCP server).",
    "",
    "The runtime provides two discovery capabilities under `tools.$rune` (its own namespace, separate",
    "from your MCP servers):",
    "- `await tools.$rune.search(query, { namespace?, limit? })` -> `{ items: [{ path, description }], total }`",
    "- `await tools.$rune.describe(path)` -> `{ path, description, signature, input, output? }` (types as TypeScript)",
    "",
    "Call a tool by its path: `await tools.<server>.<tool>(input)`. Every call — and your final `return` —",
    "uses the same envelope: `type Result<T> = { result: T; attachments?: Attachment[] }`. The signatures",
    "below (and `tools.$rune.describe`) show each tool's `T` as its return type.",
    "",
    "`result` (the `T`) is the tool's own payload. It is typed `unknown` unless the server declares an output",
    "schema — an `unknown` result has NO guaranteed shape, so inspect it (e.g. `return` it to see it, or read",
    "it defensively) before assuming any fields.",
    "",
    "`attachments` are files a tool produced (an image, a document, …), given to you as references you hold",
    "but don't read inline: `type Attachment = { type: 'file'; mime: string; filename?: string; bytes?: number }`.",
    "To actually SEE a file — e.g. look at a screenshot before deciding your next step — include it in what you",
    "`return` (e.g. `return { result: summary, attachments: shot.attachments }`): returned attachments come back",
    "into the conversation as real viewable images/files, so both YOU (on your next turn) and the user can see",
    "them. Omit an attachment to discard it. You route whole attachment handles; you don't read their raw bytes.",
    "",
    "Only what you `return` re-enters the conversation — `result` becomes text; everything else in the sandbox",
    "stays there. Compose multiple calls in one program and `return` the final value. Use `tools.$rune.search('', { namespace })` to list a namespace.",
  ]
  if (groups.size === 0) {
    lines.push("", "No MCP servers are currently connected.")
    return lines.join("\n")
  }
  // Select which signatures fit the budget (cheapest first within each server,
  // servers alphabetical) before emitting, so the list can state exactly how
  // comprehensive it is — overall and per namespace.
  const ordered = [...groups].sort(([a], [b]) => a.localeCompare(b))
  const shown = new Map<string, string[]>()
  let used = 0
  let budgetLeft = true
  let totalTools = 0
  let totalShown = 0
  for (const [server, entries] of ordered) {
    totalTools += entries.length
    const picked: string[] = []
    if (budgetLeft) {
      for (const entry of entries) {
        const line = `  - ${previewSignature(entry)}`
        if (used + line.length > PREVIEW_BUDGET) {
          budgetLeft = false
          break
        }
        picked.push(line)
        used += line.length
      }
    }
    shown.set(server, picked)
    totalShown += picked.length
  }

  const complete = totalShown === totalTools
  lines.push(
    "",
    complete
      ? "This is the COMPLETE list of available tools — every connected tool is shown below with its call signature. Use `tools.$rune.describe(path)` for a tool's full types."
      : `This is a PARTIAL list — ${totalShown} of ${totalTools} tools are shown below. Any tool not listed must be found with \`tools.$rune.search\` first; use \`tools.$rune.describe(path)\` for full types.`,
  )
  for (const [server, entries] of ordered) {
    const picked = shown.get(server)!
    const total = entries.length
    const count = `${total} tool${total === 1 ? "" : "s"}`
    // Annotate only when a namespace is not fully shown, so a comprehensive
    // namespace reads cleanly and a truncated one is unambiguous.
    const label =
      picked.length === total ? count : picked.length === 0 ? `${count}, none shown` : `${count}, ${picked.length} shown`
    lines.push(`- ${server} (${label})`)
    for (const line of picked) lines.push(line)
  }
  return lines.join("\n")
}

const lastSegment = (uri: string) => {
  const trimmed = uri.split(/[?#]/, 1)[0]!.replace(/\/+$/, "")
  const segment = trimmed.slice(trimmed.lastIndexOf("/") + 1)
  return segment.length > 0 ? segment : undefined
}

const dataUrl = (mime: string, base64: string) => `data:${mime};base64,${base64}`

/** Decoded byte length of a `data:` URL's base64 payload, or undefined for a
 *  non-data URL (e.g. an external `resource_link`) whose size we don't know. */
function dataUrlBytes(url: string): number | undefined {
  if (!url.startsWith("data:")) return undefined
  const comma = url.indexOf(",")
  if (comma === -1) return undefined
  const base64 = url.slice(comma + 1)
  if (base64.length === 0) return 0
  const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0
  return Math.max(0, Math.floor((base64.length * 3) / 4) - padding)
}

/** Functions for converting between real attachments and the opaque handles the
 *  sandbox sees. See {@link attachmentTable}. */
export type AttachmentTable = {
  /** Register a real attachment, returning the opaque handle to hand to the program. */
  seal: (attachment: Attachment) => AttachmentHandle
  /** Resolve a handle the program returned back to its real attachment, or undefined
   *  if it isn't one this table issued (a fabricated or stale handle is dropped). */
  resolve: (handle: unknown) => Attachment | undefined
}

/**
 * A per-execution table that keeps real attachment bytes host-side and only ever
 * exposes opaque handles to the sandbox. The bytes never enter the program's context,
 * so a program cannot read or accidentally re-emit them; on `return`, a propagated
 * handle is looked up here to recover the real attachment for the user.
 */
export function attachmentTable(): AttachmentTable {
  const real = new Map<string, Attachment>()
  let seq = 0
  return {
    seal(attachment) {
      const id = `att_${++seq}`
      real.set(id, attachment)
      const bytes = dataUrlBytes(attachment.url)
      return {
        type: "file",
        id,
        mime: attachment.mime,
        ...(attachment.filename ? { filename: attachment.filename } : {}),
        ...(bytes !== undefined ? { bytes } : {}),
      }
    },
    resolve(handle) {
      if (!handle || typeof handle !== "object") return undefined
      const id = (handle as Record<string, unknown>).id
      return typeof id === "string" ? real.get(id) : undefined
    },
  }
}

/**
 * Reduce an MCP tool result to the `{ result, attachments? }` envelope. `result`
 * is the structured content (or joined text); media blocks (image/audio/resource)
 * become opaque attachment handles via `seal` (the bytes stay host-side). Lenient —
 * never throws on unexpected shapes.
 */
export function toEnvelope(result: unknown, seal: AttachmentTable["seal"]): Envelope {
  if (result === null || typeof result !== "object") return { result }
  const record = result as { structuredContent?: unknown; content?: unknown }
  const attachments: AttachmentHandle[] = []
  const push = (attachment: Attachment) => attachments.push(seal(attachment))
  const text: string[] = []
  const content = Array.isArray(record.content) ? record.content : []
  for (const item of content) {
    if (!item || typeof item !== "object") continue
    const block = item as Record<string, unknown>
    switch (block.type) {
      case "text":
        if (typeof block.text === "string") text.push(block.text)
        break
      case "image":
      case "audio":
        if (typeof block.data === "string" && typeof block.mimeType === "string") {
          push({ type: "file", mime: block.mimeType, url: dataUrl(block.mimeType, block.data) })
        }
        break
      case "resource": {
        const res = block.resource as Record<string, unknown> | undefined
        if (res && typeof res === "object") {
          const mime = typeof res.mimeType === "string" ? res.mimeType : "application/octet-stream"
          const uri = typeof res.uri === "string" ? res.uri : undefined
          if (typeof res.blob === "string") {
            push({ type: "file", mime, url: dataUrl(mime, res.blob), filename: uri ? lastSegment(uri) : undefined })
          } else if (typeof res.text === "string") {
            text.push(res.text)
          }
        }
        break
      }
      case "resource_link":
        if (typeof block.uri === "string") {
          push({
            type: "file",
            mime: typeof block.mimeType === "string" ? block.mimeType : "application/octet-stream",
            url: block.uri,
            filename: typeof block.name === "string" ? block.name : lastSegment(block.uri),
          })
        }
        break
    }
  }

  const value =
    record.structuredContent !== undefined && record.structuredContent !== null
      ? record.structuredContent
      : text.length > 0
        ? text.join("\n")
        : content.length > 0
          ? undefined // media-only result
          : result

  return attachments.length > 0 ? { result: value, attachments } : { result: value }
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

/**
 * Lower the program's return value into model-facing output + attachments. The value
 * is treated as a `{ result, attachments? }` envelope when it has a `result` key;
 * otherwise the whole value is the result. Attachments are model-curated: each returned
 * handle is resolved back to its real bytes via `resolve`; anything that isn't a handle
 * this run issued is dropped.
 */
export function fromReturn(
  value: unknown,
  resolve: AttachmentTable["resolve"],
): { output: string; attachments?: Attachment[] } {
  if (value !== null && typeof value === "object" && "result" in value) {
    const env = value as { result: unknown; attachments?: unknown }
    const attachments = Array.isArray(env.attachments)
      ? env.attachments.map(resolve).filter((a): a is Attachment => a !== undefined)
      : []
    return attachments.length > 0
      ? { output: formatValue(env.result), attachments }
      : { output: formatValue(env.result) }
  }
  return { output: formatValue(value) }
}

/** A search-indexed catalog entry: the fields ranking matches against, with
 *  `searchText` (path + description + parameter names/descriptions) precomputed. */
export type SearchEntry = { path: string; server: string; description: string; searchText: string }

/** The lowercased searchable text for a tool: its path, description, and the name
 *  (and description, when present) of each input parameter. */
function searchTextFor(entry: CatalogEntry): string {
  const parts = [entry.path, entry.description]
  try {
    const schema = asSchema(entry.tool.inputSchema).jsonSchema as JSONSchema7 | undefined
    const props = schema?.properties
    if (props && typeof props === "object") {
      for (const [name, value] of Object.entries(props)) {
        parts.push(name)
        const desc = (value as JSONSchema7 | undefined)?.description
        if (typeof desc === "string") parts.push(desc)
      }
    }
  } catch {
    // fall back to path + description only
  }
  return parts.join("\n").toLowerCase()
}

/**
 * Split a query into lowercased search terms. camelCase boundaries are split
 * (`resolveLibrary` -> `resolve library`) and `_ - . /` are treated as separators,
 * so `resolve-library-id`, `resolveLibraryId`, and `resolve library id` all tokenize
 * alike. Empties and the `*` wildcard are dropped.
 */
const tokenize = (query: string) =>
  query
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((term) => term.length > 0 && term !== "*")

/**
 * Rank catalog entries against a query using tokenized, field-weighted scoring
 * (adapted from the deferred-tool-search bridge). Each term contributes per field:
 * exact tool name (20) > path substring (8) > description (4) > any searchable text (2),
 * summed across terms. Because paths are `server.tool`, the exact tier matches a
 * whole path segment (e.g. the term `search` matches `github.search`). An empty
 * query lists everything (alphabetical). Results are ranked by score, tie-broken by path.
 */
export function rankTools(
  entries: ReadonlyArray<SearchEntry>,
  query: string,
  namespace?: string,
  limit = 25,
): { items: { path: string; description: string }[]; total: number } {
  const terms = tokenize(query)
  const scoped = namespace ? entries.filter((entry) => entry.server === namespace) : entries
  const ranked = scoped
    .map((entry) => {
      const path = entry.path.toLowerCase()
      const description = entry.description.toLowerCase()
      const score = terms.reduce(
        (total, term) =>
          total +
          (path === term || path.endsWith(`.${term}`) ? 20 : 0) +
          (path.includes(term) ? 8 : 0) +
          (description.includes(term) ? 4 : 0) +
          (entry.searchText.includes(term) ? 2 : 0),
        0,
      )
      return { entry, score }
    })
    .filter((item) => terms.length === 0 || item.score > 0)
    .sort((a, b) => b.score - a.score || a.entry.path.localeCompare(b.entry.path))
  return {
    items: ranked.slice(0, limit).map(({ entry }) => ({ path: entry.path, description: brief(entry.description) })),
    total: ranked.length,
  }
}

export function define(
  mcpTools: Record<string, AITool>,
  mcpDefs: Record<string, MCPToolDef>,
  servers: readonly string[],
) {
  const groups = groupByServer(mcpTools, servers, mcpDefs)
  const catalog: CatalogEntry[] = [...groups.values()].flat()
  const byKey = new Map(catalog.map((entry) => [entry.key, entry] as const))
  const index: SearchEntry[] = catalog.map((entry) => ({
    path: entry.path,
    server: entry.server,
    description: entry.description,
    searchText: searchTextFor(entry),
  }))

  const search = (query: unknown, options: unknown) => {
    const q = typeof query === "string" ? query : ""
    const opts = (options ?? {}) as { namespace?: unknown; limit?: unknown }
    const namespace = typeof opts.namespace === "string" ? opts.namespace : undefined
    const limit = typeof opts.limit === "number" && opts.limit > 0 ? Math.floor(opts.limit) : 25
    return rankTools(index, q, namespace, limit)
  }

  const describeTool = (path: unknown) => {
    if (typeof path !== "string") return { error: { code: "invalid_path", message: "describe expects a tool path string." } }
    const entry = byKey.get(toKey([path]))
    if (!entry) {
      // Fuzzy "did you mean": rank the leaf name within its namespace, then fall
      // back to a global search. Split only on namespace separators (`. _ /`) so a
      // hyphenated tool name (e.g. `resolve-library-id`) stays one searchable leaf.
      const segments = path.split(/[._/]+/).filter((s) => s.length > 0)
      const leaf = segments.at(-1) ?? path
      const namespace = segments.length > 1 ? segments[0] : undefined
      const scoped = namespace ? rankTools(index, leaf, namespace, 5).items : []
      const suggestions = (scoped.length > 0 ? scoped : rankTools(index, leaf, undefined, 5).items).map((i) => i.path)
      return { error: { code: "tool_not_found", message: `No tool at '${path}'.`, suggestions } }
    }
    // Everything the model sees is TypeScript: `signature` is the compact one-line
    // call form; `input`/`output` are the detailed types (multi-line, with JSDoc for
    // any described fields and literal unions for enums) that raw JSON Schema used to
    // carry. `output` is present only when the server declares an outputSchema.
    let input = "unknown"
    try {
      const schema = asSchema(entry.tool.inputSchema).jsonSchema as JSONSchema7 | undefined
      input = renderType(schema, { pretty: true })
    } catch {
      input = "unknown"
    }
    return {
      path: entry.path,
      description: entry.description,
      signature: signatureFor(entry),
      input,
      ...(entry.outputSchema ? { output: renderType(entry.outputSchema, { pretty: true }) } : {}),
    }
  }

  return Tool.define(
    CODE_MODE_TOOL,
    Effect.succeed<Tool.DefWithoutID<typeof Parameters, Metadata>>({
      description: describe(groups),
      parameters: Parameters,
      execute: Effect.fn("CodeMode.execute")(function* (params, ctx) {
        const calls: CallEntry[] = []
        // Real attachment bytes stay in this table for the life of the call; the sandbox
        // only ever handles opaque references to them (see attachmentTable).
        const files = attachmentTable()
        // Stream the current call list to the UI. Sent on every status change so the
        // tool part shows each child call appearing and resolving while the program runs.
        const publish = (error?: boolean) =>
          ctx.metadata({ title: "execute", metadata: { toolCalls: calls.map((c) => ({ ...c })), ...(error ? { error } : {}) } })
        const mark = (index: number, status: CallEntry["status"]) =>
          Effect.suspend(() => {
            calls[index] = { ...calls[index]!, status }
            return publish()
          })
        const tracked = <A, E, R>(tool: string, input: unknown, effect: Effect.Effect<A, E, R>) =>
          Effect.gen(function* () {
            const index = calls.length
            const childInput = displayInput(input)
            calls.push({ tool, status: "running", ...(childInput ? { input: childInput } : {}) })
            yield* publish()
            return yield* effect.pipe(
              Effect.tap(() => mark(index, "completed")),
              Effect.tapError(() => mark(index, "error")),
            )
          })

        // One host function per MCP tool: gate on permission, dispatch to the native
        // MCP tool, and coerce the result into the { result, attachments? } envelope.
        // A failure (e.g. an MCP isError) fails the Effect, which the interpreter
        // surfaces as a catchable in-program error.
        const callTool = (entry: CatalogEntry) => (input: unknown) =>
          Effect.gen(function* () {
            yield* ctx.ask({ permission: entry.key, metadata: {}, patterns: ["*"], always: ["*"] })
            return yield* tracked(entry.path, input, Effect.tryPromise({
              try: () =>
                Promise.resolve(
                  entry.tool.execute!(input ?? {}, {
                    toolCallId: ctx.callID ?? entry.key,
                    abortSignal: ctx.abort,
                    messages: [],
                  }),
                ),
              catch: (error) => (error instanceof Error ? error : new Error(String(error))),
            }).pipe(
              Effect.map((raw) => toEnvelope(raw, files.seal)),
            ))
          })

        // The Rune host-tool tree: per-server namespaces (`tools.<server>.<tool>`)
        // plus the runtime's own discovery capabilities under `tools.$rune.*`. The
        // interpreter resolves and invokes these; approving `execute` does not
        // approve any child call.
        const tools: HostTools = {
          [RUNE_NS]: {
            [SEARCH]: (query: unknown, options: unknown) =>
              tracked(
                "$rune.search",
                { query, ...(typeof options === "object" && options !== null && !Array.isArray(options) ? options : {}) },
                Effect.succeed(search(query, options)),
              ),
            [DESCRIBE]: (path: unknown) => tracked("$rune.describe", { path }, Effect.succeed(describeTool(path))),
          },
        }
        for (const entry of catalog) {
          if (!entry.tool.execute) continue
          let namespace = tools[entry.server] as HostTools | undefined
          if (!namespace) {
            namespace = {}
            tools[entry.server] = namespace
          }
          namespace[entry.local] = callTool(entry)
        }

        const result = yield* Rune.execute({
          code: params.code,
          tools: tools as unknown as Record<string, never>,
          limits: CODE_LIMITS,
        })

        if (result.ok) {
          const { output, attachments } = fromReturn(result.value, files.resolve)
          return {
            title: "execute",
            metadata: { toolCalls: calls },
            output,
            ...(attachments && attachments.length > 0 ? { attachments } : {}),
          } satisfies Tool.ExecuteResult<Metadata>
        }
        // Point the model at discovery when it references a tool that does not exist.
        const hint =
          result.error.kind === "UnknownCapability"
            ? "\nUse tools.$rune.search(query) to discover available tools."
            : ""
        return {
          title: "execute",
          metadata: { toolCalls: calls, error: true },
          output: result.error.message + hint,
        } satisfies Tool.ExecuteResult<Metadata>
      }),
    }),
  )
}
