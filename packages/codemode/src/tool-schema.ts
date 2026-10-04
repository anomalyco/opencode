import { JsonPointer, Schema } from "effect"
import type { Definition, JsonSchema, SchemaType } from "./tool.js"

const isEffectSchema = (schema: SchemaType): schema is Schema.Decoder<unknown> & Schema.Top => Schema.isSchema(schema)

const renderLiteral = (value: unknown): string => JSON.stringify(value) ?? "unknown"

/**
 * Bare TypeScript identifier - usable unquoted as an object key (and, in the tool runtime,
 * with dot access as a tool-path segment). Anything else must be quoted/bracketed.
 */
export const identifierSegment = /^[A-Za-z_$][A-Za-z0-9_$]*$/

/** Renders a property name as a valid TS object key: bare when an identifier, quoted otherwise. */
const renderKey = (name: string): string => (identifierSegment.test(name) ? name : JSON.stringify(name))

const effectNumberSentinel = (schema: JsonSchema) =>
  schema.type === "string" &&
  Array.isArray(schema.enum) &&
  schema.enum.length === 1 &&
  (schema.enum[0] === "NaN" || schema.enum[0] === "Infinity" || schema.enum[0] === "-Infinity")

const intersection = (members: ReadonlyArray<string>): string => {
  const concrete = members.filter((member) => member !== "unknown")
  if (concrete.length === 0) return "unknown"
  if (concrete.length === 1) return concrete[0] ?? "unknown"
  return concrete.map((member) => (member.includes(" | ") ? `(${member})` : member)).join(" & ")
}

/**
 * Recursion ceiling for schema rendering. Object, array, and union recursion all increment
 * depth, so this bounds every recursion path - pathological or structurally cyclic schemas
 * degrade to `unknown` instead of overflowing the stack (rendering must never throw).
 */
const MAX_RENDER_DEPTH = 8

type RenderContext = {
  readonly definitions: Readonly<Record<string, JsonSchema>>
  /** Indented, JSDoc-annotated multiline rendering (search results); compact single line otherwise. */
  readonly pretty: boolean
}

const hasUnresolvedRef = (
  schema: JsonSchema,
  definitions: Readonly<Record<string, JsonSchema>>,
  seen: ReadonlySet<string> = new Set(),
  visited: ReadonlySet<JsonSchema> = new Set(),
): boolean => {
  if (visited.has(schema)) return false
  const nextVisited = new Set([...visited, schema])
  if (schema.$ref !== undefined) {
    const segment = schema.$ref.match(/^#\/(?:\$defs|definitions)\/([^/]+)$/)?.[1]
    const name = segment === undefined ? undefined : JsonPointer.unescapeToken(segment)
    if (name === undefined || definitions[name] === undefined || seen.has(name)) return true
    if (hasUnresolvedRef(definitions[name], definitions, new Set([...seen, name]), nextVisited)) return true
  }
  return [
    ...(schema.anyOf ?? []),
    ...(schema.oneOf ?? []),
    ...(schema.allOf ?? []),
    ...Object.values(schema.properties ?? {}),
    ...(schema.items === undefined ? [] : [schema.items]),
    ...(typeof schema.additionalProperties === "object" ? [schema.additionalProperties] : []),
  ].some((item) => hasUnresolvedRef(item, definitions, seen, nextVisited))
}

/**
 * Schema constraints a TypeScript type cannot express natively but a model benefits from,
 * surfaced as JSDoc tags (`@deprecated`, `@default`, `@format`, `@minItems`, `@maxItems`).
 */
const docTags = (schema: JsonSchema): Array<string> => {
  const tags: Array<string> = []
  if (schema.deprecated === true) tags.push("@deprecated")
  if (schema.default !== undefined) {
    try {
      const rendered = JSON.stringify(schema.default)
      if (rendered !== undefined) tags.push(`@default ${rendered}`)
    } catch {
      // unserializable default: skip rather than emit a broken tag
    }
  }
  if (typeof schema.format === "string") tags.push(`@format ${schema.format}`)
  if (typeof schema.minItems === "number") tags.push(`@minItems ${schema.minItems}`)
  if (typeof schema.maxItems === "number") tags.push(`@maxItems ${schema.maxItems}`)
  return tags
}

/**
 * Format a schema `description` plus `tags` as a JSDoc comment at the given indent,
 * preserving multi-line text (a single line stays `/** ... *\/`; multiple lines become a
 * `*`-prefixed block). `*\/` is neutralized so nothing can close the comment early, and
 * blank leading/trailing lines are trimmed. Returns "" (else a trailing newline) so
 * callers can prepend it directly to the field line.
 */
const jsdoc = (description: string | undefined, tags: ReadonlyArray<string>, pad: string): string => {
  const lines = [...(description === undefined ? [] : description.split("\n")), ...tags].map((line) =>
    line.replaceAll("*/", "* /").replace(/\s+$/, ""),
  )
  while (lines.length > 0 && lines[0]!.trim() === "") lines.shift()
  while (lines.length > 0 && lines[lines.length - 1]!.trim() === "") lines.pop()
  if (lines.length === 0) return ""
  if (lines.length === 1) return `${pad}/** ${lines[0]} */\n`
  const body = lines.map((line) => `${pad} *${line === "" ? "" : ` ${line}`}`).join("\n")
  return `${pad}/**\n${body}\n${pad} */\n`
}

const renderSchema = (
  schema: JsonSchema,
  ctx: RenderContext,
  depth = 0,
  seen: ReadonlySet<string> = new Set(),
): string => {
  if (depth > MAX_RENDER_DEPTH) return "unknown"
  const nested =
    schema.definitions === undefined && schema.$defs === undefined
      ? ctx
      : { ...ctx, definitions: { ...ctx.definitions, ...(schema.definitions ?? {}), ...(schema.$defs ?? {}) } }
  if (schema.$ref) {
    const segment = schema.$ref.match(/^#\/(?:\$defs|definitions)\/([^/]+)$/)?.[1]
    const name = segment === undefined ? undefined : JsonPointer.unescapeToken(segment)
    if (!name || !nested.definitions[name] || seen.has(name)) return "unknown"
    return intersection([
      renderSchema(nested.definitions[name], nested, depth, new Set([...seen, name])),
      renderSchema({ ...schema, $ref: undefined }, nested, depth + 1, seen),
    ])
  }
  if (schema.const !== undefined) return renderLiteral(schema.const)
  if (schema.enum) return schema.enum.map(renderLiteral).join(" | ")
  const alternatives = schema.anyOf ?? schema.oneOf
  if (alternatives) {
    // Effect's number schema emits `anyOf: [{ type: "number" }, { const: "NaN" },
    // { const: "Infinity" }, { const: "-Infinity" }]`. Collapse only that artifact;
    // real JSON Schema unions such as `string | number` or `number | null` must keep
    // every branch.
    if (
      alternatives.some((item) => item.type === "number") &&
      alternatives.every((item) => item.type === "number" || effectNumberSentinel(item))
    )
      return "number"
    // An empty Schema.Struct({}) emits `anyOf: [{ type: "object" }, { type: "array" }]`
    // (no properties/items); render the bare shape as {} instead of `{} | Array<unknown>`.
    if (
      alternatives.length === 2 &&
      alternatives[0]?.type === "object" &&
      alternatives[0].properties === undefined &&
      alternatives[1]?.type === "array" &&
      alternatives[1].items === undefined
    ) {
      return "{}"
    }
    const members = alternatives.map((item) => renderSchema(item, nested, depth + 1, seen))
    if (members.some((member) => member === "unknown")) return "unknown"
    return intersection([
      members.join(" | "),
      renderSchema({ ...schema, anyOf: undefined, oneOf: undefined }, nested, depth + 1, seen),
    ])
  }
  if (schema.allOf) {
    const members = schema.allOf.map((item) => renderSchema(item, nested, depth + 1, seen))
    if (schema.allOf.some((item) => hasUnresolvedRef(item, nested.definitions))) return "unknown"
    return intersection([renderSchema({ ...schema, allOf: undefined }, nested, depth + 1, seen), ...members])
  }
  if (Array.isArray(schema.type)) {
    return schema.type.map((item) => renderSchema({ ...schema, type: item }, nested, depth + 1, seen)).join(" | ")
  }
  if (schema.type === "string") return "string"
  if (schema.type === "number" || schema.type === "integer") return "number"
  if (schema.type === "boolean") return "boolean"
  if (schema.type === "null") return "null"
  if (schema.type === "array") return `Array<${renderSchema(schema.items ?? {}, nested, depth + 1, seen)}>`
  if (schema.type === "object" || schema.properties) {
    const required = new Set(schema.required ?? [])
    const properties = Object.entries(schema.properties ?? {})
    const additional = schema.additionalProperties
    const indexType =
      additional && typeof additional === "object" ? renderSchema(additional, nested, depth + 1, seen) : undefined
    const field = ([name, value]: readonly [string, JsonSchema]) =>
      `${renderKey(name)}${required.has(name) ? "" : "?"}: ${renderSchema(value, nested, depth + 1, seen)}`

    if (!ctx.pretty) {
      const fields = properties.map(field)
      if (indexType !== undefined) fields.push(`[key: string]: ${indexType}`)
      return fields.length === 0 ? "{}" : `{ ${fields.join("; ")} }`
    }

    // Pretty: an indented block, each described field preceded by its JSDoc comment.
    if (properties.length === 0 && indexType === undefined) return "{}"
    const pad = "  ".repeat(depth + 1)
    const lines = properties.map(
      (entry) => `${jsdoc(entry[1].description, docTags(entry[1]), pad)}${pad}${field(entry)},`,
    )
    if (indexType !== undefined) lines.push(`${pad}[key: string]: ${indexType},`)
    return `{\n${lines.join("\n")}\n${"  ".repeat(depth)}}`
  }
  return "unknown"
}

export const toTypeScript = (schema: Schema.Top, decoded = false, pretty = false): string => {
  try {
    const visible = decoded ? Schema.toType(schema) : schema
    const document = Schema.toJsonSchemaDocument(visible) as {
      readonly schema: JsonSchema
      readonly definitions?: Readonly<Record<string, JsonSchema>>
    }
    return renderSchema(document.schema, { definitions: document.definitions ?? {}, pretty })
  } catch {
    return "unknown"
  }
}

/** Renders a raw JSON Schema document as a TypeScript type string. */
export const jsonSchemaToTypeScript = (schema: JsonSchema, pretty = false): string => {
  try {
    return renderSchema(schema, { definitions: { ...(schema.definitions ?? {}), ...(schema.$defs ?? {}) }, pretty })
  } catch {
    return "unknown"
  }
}

/** One input property of a tool, extracted best-effort from its input schema. */
export type InputProperty = {
  readonly name: string
  readonly description: string | undefined
  readonly required: boolean
}

/**
 * The property names, descriptions, and required flags of a tool's input schema - the raw
 * material for search text. Best-effort: Effect Schemas go through their
 * JSON Schema document (the same emission signature rendering uses); JSON Schemas are read
 * directly, resolving a trivial top-level `$ref` into `$defs`/`definitions` when present.
 * Anything unresolvable yields `[]` (search falls back to path + description).
 */
export const inputProperties = <R>(definition: Definition<R>): Array<InputProperty> => {
  try {
    const document = isEffectSchema(definition.input)
      ? (Schema.toJsonSchemaDocument(definition.input) as {
          readonly schema: JsonSchema
          readonly definitions?: Readonly<Record<string, JsonSchema>>
        })
      : {
          schema: definition.input,
          definitions: { ...(definition.input.definitions ?? {}), ...(definition.input.$defs ?? {}) },
        }
    const definitions = document.definitions ?? {}
    let schema = document.schema
    if (schema.$ref !== undefined) {
      const segment = schema.$ref.match(/^#\/(?:\$defs|definitions)\/([^/]+)$/)?.[1]
      const name = segment === undefined ? undefined : JsonPointer.unescapeToken(segment)
      const resolved = name === undefined ? undefined : definitions[name]
      if (resolved === undefined) return []
      schema = resolved
    }
    const required = new Set(schema.required ?? [])
    return Object.entries(schema.properties ?? {}).map(([name, value]) => ({
      name,
      description: typeof value.description === "string" ? value.description : undefined,
      required: required.has(name),
    }))
  } catch {
    return []
  }
}

/**
 * The model-visible TypeScript type of a tool's input. `pretty` renders an indented
 * multiline block with schema descriptions and constraints as JSDoc comments on the
 * fields; the default stays the compact single-line form.
 */
export const inputTypeScript = <R>(definition: Definition<R>, pretty = false): string =>
  isEffectSchema(definition.input)
    ? toTypeScript(definition.input, false, pretty)
    : jsonSchemaToTypeScript(definition.input, pretty)

/**
 * The model-visible TypeScript type of a tool's result; tools without an output schema
 * return `unknown`. `pretty` renders the JSDoc-annotated multiline form, as for inputs.
 */
export const outputTypeScript = <R>(definition: Definition<R>, pretty = false): string =>
  definition.output === undefined
    ? "unknown"
    : isEffectSchema(definition.output)
      ? toTypeScript(definition.output, true, pretty)
      : jsonSchemaToTypeScript(definition.output, pretty)

/**
 * Decodes tool input before `run` is invoked. Effect Schemas validate (throwing on failure);
 * JSON-Schema-described inputs pass through unvalidated (render-only).
 */
export const decodeInput = <R>(definition: Definition<R>, value: unknown): unknown =>
  isEffectSchema(definition.input) ? Schema.decodeUnknownSync(definition.input)(value) : value

/**
 * Decodes a tool result before it is exposed to the program. Effect Schemas validate and
 * transform (throwing on failure); JSON Schema outputs and tools without an output schema pass
 * the host value through unchanged.
 */
export const decodeOutput = <R>(definition: Definition<R>, value: unknown): unknown =>
  definition.output !== undefined && isEffectSchema(definition.output)
    ? Schema.decodeUnknownSync(definition.output)(value)
    : value
