import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import {
  CallToolResultSchema,
  ListToolsResultSchema,
  ToolSchema,
  type Tool as MCPToolDef,
} from "@modelcontextprotocol/sdk/types.js"
import { dynamicTool, jsonSchema, type JSONSchema7, type Tool } from "ai"
import { Effect } from "effect"

const DEFAULT_TIMEOUT = 30_000
const MAX_LIST_PAGES = 1_000
// A hostile MCP server controls its own tool description and input schema, both of
// which are injected verbatim into the model's tool manifest. Bound them so a server
// cannot dominate the prompt or force pathological serialization work.
const MAX_DESCRIPTION_LENGTH = 4_000
const MAX_SCHEMA_DEPTH = 8
const MAX_SCHEMA_NODES = 500

const TolerantListToolsResultSchema = ListToolsResultSchema.extend({
  tools: ToolSchema.omit({ outputSchema: true }).array(),
})

export async function paginate<T, R extends { nextCursor?: string }>(
  list: (cursor?: string) => Promise<R>,
  items: (result: R) => T[],
) {
  const result: T[] = []
  const cursors = new Set<string>()
  let cursor: string | undefined

  for (let page = 0; page < MAX_LIST_PAGES; page++) {
    const page = await list(cursor)
    result.push(...items(page))
    if (page.nextCursor === undefined) return result
    if (cursors.has(page.nextCursor)) throw new Error(`MCP list returned duplicate cursor: ${page.nextCursor}`)
    cursors.add(page.nextCursor)
    cursor = page.nextCursor
  }

  throw new Error(`MCP list exceeded ${MAX_LIST_PAGES} pages`)
}

export function defs(client: Client, timeout?: number) {
  return listTools(client, timeout ?? DEFAULT_TIMEOUT).pipe(Effect.catch(() => Effect.void))
}

export function convertTool(mcpTool: MCPToolDef, client: Client, timeout?: number, server?: string): Tool {
  const bounded = boundSchema(mcpTool.inputSchema)
  // A non-object input schema never reaches here (the MCP SDK zod schema requires an
  // object), but guard anyway so a malformed or null tool cannot throw a `TypeError`.
  const schema = typeof bounded === "object" && bounded !== null ? (bounded as JSONSchema7) : {}
  const properties = (schema.properties ?? {}) as NonNullable<JSONSchema7["properties"]>
  // Pruning can drop a property while its `required` entry survives, and the root
  // sets `additionalProperties: false`; the result is a schema no instance can
  // satisfy, silently making the tool permanently uncallable. Restrict `required`
  // to keys that still exist, dropping the keyword entirely when none survive.
  const required = Array.isArray(schema.required)
    ? schema.required.filter((key): key is string => typeof key === "string" && Object.hasOwn(properties, key))
    : undefined
  const inputSchema: JSONSchema7 = {
    ...schema,
    type: "object",
    properties,
    additionalProperties: false,
  }
  if (required && required.length > 0) inputSchema.required = required
  else if (Array.isArray(schema.required) && schema.required.length === 0) inputSchema.required = []
  else delete inputSchema.required
  dropDanglingRefs(inputSchema)

  return dynamicTool({
    description: describeTool(mcpTool.description, server),
    inputSchema: jsonSchema(inputSchema),
    execute: async (args: unknown, options) => {
      const result = await client.callTool(
        {
          name: mcpTool.name,
          arguments: (args || {}) as Record<string, unknown>,
        },
        CallToolResultSchema,
        {
          resetTimeoutOnProgress: true,
          signal: options.abortSignal,
          timeout,
          // The MCP SDK only sends a progress token when this hook is present, enabling timeout resets.
          onprogress: () => {},
        },
      )
      if (result.isError)
        throw new Error(
          result.content
            .flatMap((item) => (item.type === "text" ? [item.text] : []))
            .filter((text) => text.trim())
            .join("\n\n") || "MCP tool returned an error",
        )
      if (result.content.length > 0 || result.structuredContent === undefined || result.structuredContent === null)
        return result
      return {
        ...result,
        content: [{ type: "text" as const, text: JSON.stringify(result.structuredContent) }],
      }
    },
  })
}

export function fetch<T extends { name: string }>(
  clientName: string,
  client: Client,
  list: (client: Client) => Promise<T[]>,
  label: string,
  key?: (item: T) => string,
) {
  return Effect.tryPromise({
    try: () => list(client),
    catch: (error) => error,
  }).pipe(
    Effect.tapError((error) =>
      Effect.logWarning(`failed to get ${label}`, {
        clientName,
        error: error instanceof Error ? error.message : String(error),
      }),
    ),
    Effect.map((items) => {
      const sanitizedClient = sanitize(clientName)
      // Escape both the separator and escape marker so `server:uri` keys remain unambiguous.
      const resourceClient = clientName.replaceAll("%", "%25").replaceAll(":", "%3A")
      return Object.fromEntries(
        items.map((item) => [
          key ? resourceClient + ":" + key(item) : sanitizedClient + ":" + sanitize(item.name),
          { ...item, client: clientName },
        ]),
      )
    }),
    Effect.orElseSucceed(() => undefined),
  )
}

export const sanitize = (value: string) => value.replace(/[^a-zA-Z0-9_-]/g, "_")

export const toolName = (clientName: string, name: string) => sanitize(clientName) + "_" + sanitize(name)

// `sanitize` collapses distinct raw names (`a.b`, `a_b`, `a b`) to one string, so a
// registry keyed by `toolName` silently overwrites the earlier server's tool. Assign
// names for a whole batch so later claimants get a stable hash suffix instead.
export function assignToolNames(entries: { clientName: string; name: string }[]) {
  const used = new Set<string>()
  const assigned = new Map<string, Map<string, string>>()

  for (const entry of entries) {
    const base = toolName(entry.clientName, entry.name)
    let candidate = base
    for (let attempt = 0; used.has(candidate); attempt++) {
      candidate = `${base}_${hashSuffix(`${entry.clientName}\u0000${entry.name}\u0000${attempt}`)}`
    }
    used.add(candidate)
    const perServer = assigned.get(entry.clientName) ?? new Map<string, string>()
    perServer.set(entry.name, candidate)
    assigned.set(entry.clientName, perServer)
  }

  return assigned
}

function hashSuffix(value: string) {
  let hash = 2166136261
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(36)
}

function describeTool(description: string | undefined, server: string | undefined) {
  const text = description ?? ""
  const capped = text.length > MAX_DESCRIPTION_LENGTH ? `${text.slice(0, MAX_DESCRIPTION_LENGTH)}...` : text
  return server ? `[${server}] ${capped}` : capped
}

// A hostile MCP server controls its own input schema, so bound its depth and node
// count to keep it from dominating the prompt or forcing pathological serialization.
// When a subtree exceeds the bound (or cycles) DROP it rather than substituting a
// placeholder: `{}` widens validation, while any non-array placeholder substituted
// into an array-valued keyword (`required: {}`) or a schema-object keyword
// (`properties: { not: {} }`) emits invalid JSON Schema — strict providers then
// reject the whole tool manifest (Anthropic: "must match JSON Schema draft
// 2020-12"; Meta/OpenRouter: "not valid under any of the schemas"). Dropping keeps
// the bounded document valid; the omitted subtree simply stops constraining.
const BOUNDED = Symbol("opencode.mcp.boundedSchema")
type Bounded = typeof BOUNDED

// Keywords that are invalid when emitted as `[]`: `anyOf`/`oneOf`/`allOf`/`enum`/
// `prefixItems` must be non-empty and a `type` array must name at least one type.
// An empty array can arrive from the source (the MCP SDK zod schema passes it through)
// or be left by pruning; both are dropped at the parent. `required` is deliberately
// absent because an empty `required` is valid.
const NON_EMPTY_ARRAY_KEYWORDS = new Set(["anyOf", "oneOf", "allOf", "enum", "type", "prefixItems"])
// `type` may be a string or an array of strings, but every member must name a real
// JSON Schema type; a bad member makes the whole document meta-invalid.
const JSON_TYPES = new Set(["null", "boolean", "object", "array", "number", "string", "integer"])
// Keywords whose value must be a map of schemas; a non-object value is dropped.
const SCHEMA_MAP_KEYWORDS = new Set(["properties", "$defs", "definitions", "patternProperties", "dependentSchemas"])
// Keywords whose value must be a single schema (object or boolean).
const SCHEMA_VALUE_KEYWORDS = new Set([
  "items",
  "additionalProperties",
  "additionalItems",
  "unevaluatedProperties",
  "unevaluatedItems",
  "propertyNames",
  "contains",
  "not",
  "if",
  "then",
  "else",
  "contentSchema",
])
// Keywords whose value is an array of schemas.
const SCHEMA_ARRAY_KEYWORDS = new Set(["anyOf", "oneOf", "allOf"])
// Numeric keywords that must be non-negative integers, and those that must be finite numbers.
// A wrongly-typed bound makes the whole document meta-invalid and ajv refuses to compile it.
const NON_NEGATIVE_INTEGER_KEYWORDS = new Set([
  "minLength",
  "maxLength",
  "minItems",
  "maxItems",
  "minProperties",
  "maxProperties",
  "minContains",
  "maxContains",
])
const NUMBER_KEYWORDS = new Set(["minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum", "multipleOf"])
// String- and boolean-valued keywords; a wrong type is meta-invalid.
const STRING_KEYWORDS = new Set([
  "pattern",
  "format",
  "contentEncoding",
  "contentMediaType",
  "$comment",
  "title",
  "description",
])
const BOOLEAN_KEYWORDS = new Set(["uniqueItems", "deprecated", "readOnly", "writeOnly"])

// ajv compiles `patternProperties` keys and `pattern` values with the JS `RegExp` constructor;
// a value that does not parse makes the whole document uncompilable.
const isValidRegex = (value: string) => {
  try {
    new RegExp(value)
    return true
  } catch {
    return false
  }
}

// JSON Schema 2020-12 anchors start with a letter or underscore and continue with
// `[-A-Za-z0-9._]`; ajv's meta-schema rejects any other name.
const ANCHOR_PATTERN = /^[A-Za-z_][-A-Za-z0-9._]*$/

// ajv resolves `$schema` against its registered meta-schemas; any other value fails the whole
// document with `no schema with key or ref`. Keep only dialects the installed ajv knows.
const KNOWN_DIALECTS = new Set([
  "https://json-schema.org/draft/2020-12/schema",
  "https://json-schema.org/draft/2020-12/schema#",
  "http://json-schema.org/schema#",
])

// `$id` must not contain an interior fragment, and a `urn:` id needs a non-empty NID and NSS
// or ajv cannot serialize it ("URN without nid").
const isResolvableId = (value: string) => {
  const hash = value.indexOf("#")
  if (hash !== -1 && hash !== value.length - 1) return false
  if (/^urn:/i.test(value) && !/^urn:[a-z0-9][a-z0-9-]*:.+/i.test(value)) return false
  return true
}

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)
const isSchema = (value: unknown) => typeof value === "boolean" || isPlainObject(value)
// Schema maps are emitted with a null prototype so a `__proto__` member arriving from an
// untrusted server is stored as an own key instead of rewriting the map's prototype.
const makeRecord = () => Object.create(null) as Record<string, unknown>

// Schemas, maps of schemas (`properties`/`$defs`) and instance data (`enum`/`const`)
// all recurse through `boundSchema`. Only real schema nodes are sanitized; without the
// distinction a property literally named `required` or an `enum` value would be mistaken
// for a keyword and silently dropped.
type SchemaKind = "schema" | "map" | "instance"

function boundSchema(
  value: unknown,
  depth = 0,
  seen = new WeakSet<object>(),
  counter = { nodes: 0, anchors: new Set<string>() },
  kind: SchemaKind = "schema",
): unknown | Bounded {
  if (value === null || typeof value !== "object") return value
  if (depth > MAX_SCHEMA_DEPTH || counter.nodes >= MAX_SCHEMA_NODES || seen.has(value)) return BOUNDED
  seen.add(value)
  counter.nodes++
  if (Array.isArray(value)) {
    const bounded = value.flatMap((item) => {
      const child = boundSchema(item, depth + 1, seen, counter, kind)
      return child === BOUNDED ? [] : [child]
    })
    // If every member of a non-empty source array was pruned, return BOUNDED so the
    // parent drops the keyword instead of emitting `[]`. A source-empty array is
    // returned as-is and filtered by the parent against NON_EMPTY_ARRAY_KEYWORDS.
    if (value.length > 0 && bounded.length === 0) return BOUNDED
    return bounded
  }
  const out = makeRecord()
  for (const [key, item] of Object.entries(value)) {
    // Draft-07 tuple form (`items: [a, b]`) is invalid under 2020-12, where `items`
    // must be a single schema. Normalize conservatively to an unconstrained schema
    // instead of re-expressing positional constraints; the input was already
    // non-2020-12, and the bounded output must not be.
    if (kind === "schema" && key === "items" && Array.isArray(item)) {
      out[key] = {}
      continue
    }
    // `prefixItems` must be a non-empty array of schemas; non-schema entries and an
    // emptied list are dropped rather than emitted invalid.
    if (kind === "schema" && key === "prefixItems") {
      if (!Array.isArray(item)) continue
      const kept = item.flatMap((entry) => {
        const bounded = boundSchema(entry, depth + 1, seen, counter, "schema")
        return bounded === BOUNDED || !isSchema(bounded) ? [] : [bounded]
      })
      if (kept.length > 0) out[key] = kept
      continue
    }
    // `patternProperties` keys are compiled as regular expressions by ajv; an invalid key makes
    // the whole document uncompilable even though the meta-schema accepts it, so drop that entry.
    if (kind === "schema" && key === "patternProperties") {
      if (!isPlainObject(item)) continue
      const clean = makeRecord()
      for (const [pattern, entry] of Object.entries(item)) {
        if (!isValidRegex(pattern)) continue
        const bounded = boundSchema(entry, depth + 1, seen, counter, "schema")
        if (bounded === BOUNDED || !isSchema(bounded)) continue
        clean[pattern] = bounded
      }
      out[key] = clean
      continue
    }
    const childKind: SchemaKind =
      kind === "map"
        ? "schema"
        : kind === "instance"
          ? "instance"
          : SCHEMA_MAP_KEYWORDS.has(key)
            ? "map"
            : SCHEMA_VALUE_KEYWORDS.has(key) || SCHEMA_ARRAY_KEYWORDS.has(key)
              ? "schema"
              : "instance"
    const bounded = boundSchema(item, depth + 1, seen, counter, childKind)
    if (bounded === BOUNDED) continue
    if (kind === "map") {
      // Members of `properties`/`$defs`/`patternProperties`/`dependentSchemas` must
      // themselves be schemas. A string or array member is meta-invalid and lets a
      // sloppy server make strict providers reject the whole tool manifest.
      if (!isSchema(bounded)) continue
      out[key] = bounded
      continue
    }
    if (kind === "schema") {
      // A `required` that is not an array of strings cannot constrain anything and is
      // invalid JSON Schema; keep only the string members, dropping the keyword if none.
      if (key === "required") {
        if (!Array.isArray(bounded)) continue
        out[key] = bounded.filter((entry): entry is string => typeof entry === "string")
        continue
      }
      if (key === "type") {
        if (typeof bounded === "string") {
          if (JSON_TYPES.has(bounded)) out[key] = bounded
          continue
        }
        if (!Array.isArray(bounded)) continue
        const members = bounded.filter((entry): entry is string => typeof entry === "string" && JSON_TYPES.has(entry))
        if (members.length > 0) out[key] = members
        continue
      }
      if (key === "dependentRequired") {
        if (!isPlainObject(bounded)) continue
        const clean = makeRecord() as Record<string, string[]>
        for (const [name, names] of Object.entries(bounded)) {
          if (!Array.isArray(names)) continue
          const kept = names.filter((entry): entry is string => typeof entry === "string")
          if (kept.length > 0) clean[name] = kept
        }
        if (Object.keys(clean).length > 0) out[key] = clean
        continue
      }
      if (key === "$ref") {
        if (typeof bounded !== "string") continue
        out[key] = bounded
        continue
      }
      if (key === "$dynamicRef") {
        // ajv only resolves hash-fragment dynamic refs; an absolute/flat form is rejected.
        if (typeof bounded === "string" && bounded.startsWith("#")) out[key] = bounded
        continue
      }
      if (key === "$anchor" || key === "$dynamicAnchor") {
        // `$anchor` and `$dynamicAnchor` share one plain-name namespace; ajv refuses a document
        // with a duplicate ("resolves to more than one schema"), so first-wins and strip the rest.
        if (typeof bounded === "string" && ANCHOR_PATTERN.test(bounded) && !counter.anchors.has(bounded)) {
          counter.anchors.add(bounded)
          out[key] = bounded
        }
        continue
      }
      if (key === "$id") {
        if (typeof bounded === "string" && isResolvableId(bounded)) out[key] = bounded
        continue
      }
      if (key === "$schema") {
        if (typeof bounded === "string" && KNOWN_DIALECTS.has(bounded)) out[key] = bounded
        continue
      }
      if (key === "$vocabulary") {
        if (!isPlainObject(bounded)) continue
        const clean = makeRecord()
        for (const [vocabulary, flag] of Object.entries(bounded)) {
          if (typeof flag === "boolean") clean[vocabulary] = flag
        }
        out[key] = clean
        continue
      }
      if (SCHEMA_ARRAY_KEYWORDS.has(key)) {
        // Array members must themselves be schemas (object or boolean). `prefixItems` already
        // filters, but `anyOf`/`oneOf`/`allOf` emitted a non-schema member verbatim, which is
        // meta-invalid and makes ajv refuse the whole manifest (NEW-V11-03).
        if (!Array.isArray(bounded)) continue
        const members = bounded.filter(isSchema)
        if (members.length > 0) out[key] = members
        continue
      }
      if (key === "enum") {
        if (Array.isArray(bounded) && bounded.length > 0) out[key] = bounded
        continue
      }
      if (key === "examples") {
        if (Array.isArray(bounded)) out[key] = bounded
        continue
      }
      if (NON_NEGATIVE_INTEGER_KEYWORDS.has(key)) {
        if (typeof bounded === "number" && Number.isInteger(bounded) && bounded >= 0) out[key] = bounded
        continue
      }
      if (NUMBER_KEYWORDS.has(key)) {
        if (typeof bounded !== "number" || !Number.isFinite(bounded)) continue
        if (key === "multipleOf" && bounded <= 0) continue
        out[key] = bounded
        continue
      }
      if (key === "pattern") {
        if (typeof bounded !== "string") continue
        try {
          new RegExp(bounded)
        } catch {
          continue
        }
        out[key] = bounded
        continue
      }
      if (STRING_KEYWORDS.has(key)) {
        if (typeof bounded === "string") out[key] = bounded
        continue
      }
      if (BOOLEAN_KEYWORDS.has(key)) {
        if (typeof bounded === "boolean") out[key] = bounded
        continue
      }
      if (NON_EMPTY_ARRAY_KEYWORDS.has(key) && Array.isArray(bounded) && bounded.length === 0) continue
      if (SCHEMA_MAP_KEYWORDS.has(key)) {
        if (!isPlainObject(bounded)) continue
        out[key] = bounded
        continue
      }
      if (SCHEMA_VALUE_KEYWORDS.has(key)) {
        if (!isSchema(bounded)) continue
        out[key] = bounded
        continue
      }
    }
    out[key] = bounded
  }
  // Pruning can drop a property while its `required` entry survives. With
  // `additionalProperties: false` that is an unsatisfiable subschema, silently making
  // the tool (or one of its branches) uncallable; filter `required` to the emitted
  // property names at every schema node.
  if (kind === "schema" && Array.isArray(out.required)) {
    const properties = isPlainObject(out.properties) ? out.properties : {}
    const required = out.required.filter((key) => typeof key === "string" && Object.hasOwn(properties, key))
    if (required.length > 0) out.required = required
    else if (out.required.length > 0) delete out.required
  }
  return out
}

// Only names in the document's *top-level* `$defs`/`definitions` are reachable from a
// root JSON pointer. A name that exists only in a nested `$defs`, or that came from an
// `enum` value, must not be treated as resolvable (`#/$defs/X` cannot reach it).
function topLevelDefs(root: unknown) {
  const names = new Map<string, Set<string>>([
    ["$defs", new Set<string>()],
    ["definitions", new Set<string>()],
  ])
  if (!isPlainObject(root)) return names
  for (const section of ["$defs", "definitions"]) {
    const map = root[section]
    if (isPlainObject(map)) for (const name of Object.keys(map)) names.get(section)!.add(name)
  }
  return names
}

function resolvePointer(root: unknown, ref: string) {
  if (ref === "#" || ref === "#/") return true
  const fragment = ref.slice(1)
  if (!fragment.startsWith("/")) return false
  const tokens = fragment
    .slice(1)
    .split("/")
    .map((token) => token.replace(/~1/g, "/").replace(/~0/g, "~"))
  let current: unknown = root
  for (const token of tokens) {
    if (Array.isArray(current)) {
      const index = Number(token)
      if (!Number.isInteger(index) || index < 0 || index >= current.length) return false
      current = current[index]
      continue
    }
    if (!isPlainObject(current) || !Object.hasOwn(current, token)) return false
    current = current[token]
  }
  return true
}

// A plain-name `$ref` (`#name`) resolves against the anchors declared in its own schema
// resource, so an anchor only satisfies a ref sharing its nearest `$id` scope; ajv rejects
// a ref that reaches an anchor in another resource. Collect the anchors that survive in the
// emitted document, keyed by resource. Only positions ajv registers anchors from are
// walked: it ignores an `$anchor` on the top-level schema itself and inside `prefixItems`,
// while an `$anchor` under `enum`/`const`/a custom keyword is instance data (NEW-V14-07).
function collectAnchors(root: unknown) {
  const byResource = new Map<string, Set<string>>()
  const walk = (value: unknown, kind: SchemaKind, resource: string, atRoot: boolean) => {
    if (Array.isArray(value)) {
      value.forEach((item) => walk(item, kind, resource, false))
      return
    }
    if (!isPlainObject(value)) return
    const nodeResource = kind === "schema" && typeof value.$id === "string" ? value.$id : resource
    for (const [key, item] of Object.entries(value)) {
      if (!atRoot && kind === "schema" && (key === "$anchor" || key === "$dynamicAnchor")) {
        if (typeof item === "string") {
          const names = byResource.get(nodeResource)
          if (names) names.add(item)
          else byResource.set(nodeResource, new Set([item]))
        }
        continue
      }
      const childKind: SchemaKind =
        kind === "map"
          ? "schema"
          : kind === "instance"
            ? "instance"
            : key === "enum" || key === "const" || key === "default" || key === "examples"
              ? "instance"
              : SCHEMA_MAP_KEYWORDS.has(key)
                ? "map"
                : SCHEMA_VALUE_KEYWORDS.has(key) || SCHEMA_ARRAY_KEYWORDS.has(key)
                  ? "schema"
                  : "instance"
      walk(item, childKind, nodeResource, false)
    }
  }
  walk(root, "schema", "", true)
  return byResource
}

// A `$defs` entry can be pruned (depth, node budget, or shared identity) while a `$ref`
// to it survives, leaving an unresolvable local reference that makes providers reject the
// whole manifest. Drop such refs, leaving the containing schema unconstrained. Only
// schema positions are walked, so a `$ref` inside `enum`/`const` instance data is left
// alone, and every other local pointer is checked against the emitted document.
function dropDanglingRefs(
  value: unknown,
  root: unknown = value,
  kind: SchemaKind = "schema",
  defs: Map<string, Set<string>> = topLevelDefs(root),
  anchors: Map<string, Set<string>> = collectAnchors(root),
  resource = "",
) {
  if (Array.isArray(value)) {
    value.forEach((item) => dropDanglingRefs(item, root, kind, defs, anchors, resource))
    return
  }
  if (!isPlainObject(value)) return
  const nodeResource = kind === "schema" && typeof value.$id === "string" ? value.$id : resource
  for (const [key, item] of Object.entries(value)) {
    if (kind === "schema" && key === "$ref") {
      // Only local `#` pointers are resolvable in the emitted document. `urn:`/relative/
      // absolute refs make ajv (and strict providers) reject the whole manifest, so drop
      // them along with genuinely dangling local pointers (NEW-V11-04).
      if (typeof item !== "string" || !item.startsWith("#")) {
        delete value[key]
        continue
      }
      const def = /^#\/(\$defs|definitions)\/([^/]+)$/.exec(item)
      if (def) {
        if (!defs.get(def[1])?.has(def[2])) delete value[key]
        continue
      }
      // `#name` is a plain-name anchor reference. Keep it only when an anchor with that
      // name survives in the same `$id` resource; a ref to an anchor that was stripped or
      // never existed stays dangling and is pruned like any other unresolvable pointer.
      if (item.length > 1 && item[1] !== "/" && anchors.get(nodeResource)?.has(item.slice(1))) continue
      if (!resolvePointer(root, item)) delete value[key]
      continue
    }
    const childKind: SchemaKind =
      kind === "map"
        ? "schema"
        : kind === "instance"
          ? "instance"
          : key === "enum" || key === "const" || key === "default" || key === "examples"
            ? "instance"
            : SCHEMA_MAP_KEYWORDS.has(key)
              ? "map"
              : "schema"
    dropDanglingRefs(item, root, childKind, defs, anchors, nodeResource)
  }
}

export function prompts(client: Client, timeout?: number) {
  if (!client.getServerCapabilities()?.prompts) return Promise.resolve([])
  return paginate(
    (cursor) => client.listPrompts(cursor === undefined ? undefined : { cursor }, { timeout }),
    (result) => result.prompts,
  )
}

export function resources(client: Client, timeout?: number) {
  if (!client.getServerCapabilities()?.resources) return Promise.resolve([])
  return paginate(
    (cursor) => client.listResources(cursor === undefined ? undefined : { cursor }, { timeout }),
    (result) => result.resources,
  )
}

export function resourceTemplates(client: Client, timeout?: number) {
  if (!client.getServerCapabilities()?.resources) return Promise.resolve([])
  return paginate(
    (cursor) => client.listResourceTemplates(cursor === undefined ? undefined : { cursor }, { timeout }),
    (result) => result.resourceTemplates,
  )
}

function listTools(client: Client, timeout: number) {
  return Effect.tryPromise({
    try: () =>
      paginate(
        async (cursor) => {
          const params = cursor === undefined ? undefined : { cursor }
          try {
            return await client.listTools(params, { timeout })
          } catch (error) {
            if (!(error instanceof Error) || !isOutputSchemaValidationError(error)) throw error
            return client.request({ method: "tools/list", params }, TolerantListToolsResultSchema, { timeout })
          }
        },
        (result) => result.tools,
      ),
    catch: (error) => (error instanceof Error ? error : new Error(String(error))),
  })
}

function isOutputSchemaValidationError(error: Error) {
  return /can't resolve reference|resolves to more than one schema|outputSchema|schema.*reference|reference.*schema/i.test(
    error.message,
  )
}

export * as McpCatalog from "./catalog"
