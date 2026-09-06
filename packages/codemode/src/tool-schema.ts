import { JsonPointer, Schema } from "effect"
import type { Tool, JsonSchema, SchemaType } from "./tool.js"

const isEffectSchema = (schema: SchemaType): schema is Schema.Decoder<unknown> & Schema.Top => Schema.isSchema(schema)

const renderLiteral = (value: unknown): string => JSON.stringify(value) ?? "unknown"

export const identifierSegment = /^[A-Za-z_$][A-Za-z0-9_$]*$/

const renderKey = (name: string): string => (identifierSegment.test(name) ? name : JSON.stringify(name))

const effectNumberSentinel = (schema: JsonSchema) =>
  schema.type === "string" &&
  Array.isArray(schema.enum) &&
  schema.enum.length === 1 &&
  (schema.enum[0] === "NaN" || schema.enum[0] === "Infinity" || schema.enum[0] === "-Infinity")

const intersection = (members: ReadonlyArray<string>): string => {
  const concrete = members.filter((member) => member !== "unknown")
  if (concrete.length === 0) return "unknown"
  if (concrete.length === 1) return concrete[0]
  return concrete.map((member) => (member.includes(" | ") ? `(${member})` : member)).join(" & ")
}

const MAX_RENDER_DEPTH = 8

type RenderContext = {
  readonly definitions: Readonly<Record<string, JsonSchema>>
  readonly pretty: boolean
  readonly bigints?: WeakSet<JsonSchema>
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

const docTags = (schema: JsonSchema): Array<string> => {
  const tags: Array<string> = []
  if (schema.deprecated === true) tags.push("@deprecated")
  if (schema.default !== undefined) {
    try {
      const rendered = JSON.stringify(schema.default)
      if (rendered !== undefined) tags.push(`@default ${rendered}`)
    } catch {}
  }
  if (typeof schema.format === "string") tags.push(`@format ${schema.format}`)
  if (schema.type === "integer") tags.push("@integer")
  if (typeof schema.minimum === "number") tags.push(`@minimum ${schema.minimum}`)
  if (typeof schema.maximum === "number") tags.push(`@maximum ${schema.maximum}`)
  if (typeof schema.exclusiveMinimum === "number") tags.push(`@exclusiveMinimum ${schema.exclusiveMinimum}`)
  if (typeof schema.exclusiveMaximum === "number") tags.push(`@exclusiveMaximum ${schema.exclusiveMaximum}`)
  if (typeof schema.multipleOf === "number") tags.push(`@multipleOf ${schema.multipleOf}`)
  if (typeof schema.minLength === "number") tags.push(`@minLength ${schema.minLength}`)
  if (typeof schema.maxLength === "number") tags.push(`@maxLength ${schema.maxLength}`)
  if (typeof schema.pattern === "string") tags.push(`@pattern ${schema.pattern}`)
  if (typeof schema.minItems === "number") tags.push(`@minItems ${schema.minItems}`)
  if (typeof schema.maxItems === "number") tags.push(`@maxItems ${schema.maxItems}`)
  if (schema.uniqueItems === true) tags.push("@uniqueItems true")
  return tags
}

const docLines = (schema: JsonSchema, width: number): Array<string> => {
  const summary = docTags(schema).join(" ")
  const lines = (schema.description ?? "").split("\n").map((line) => line.replace(/\s+$/, ""))
  while (lines.length > 0 && lines[0]!.trim() === "") lines.shift()
  while (lines.length > 0 && lines[lines.length - 1]!.trim() === "") lines.pop()
  const inline = lines.length === 1 ? `${lines[0]}${lines[0].endsWith(".") ? "" : "."} ${summary}` : summary
  return summary && lines.length === 1 && !summary.includes("\n") && width + inline.length + 7 <= 120
    ? [inline]
    : [...lines, ...(summary ? summary.split("\n") : [])]
}

// Neutralize `*\/` so model-provided schema text cannot terminate generated documentation.
const jsdoc = (schema: JsonSchema, pad: string): string => {
  const content = docLines(schema, pad.length)
  const types = typeof schema.type === "string" ? [schema.type] : (schema.type ?? [])

  const append = (label: string, child: JsonSchema) => {
    docLines(child, pad.length + label.length + 2).forEach((line, index) => {
      if (index === 0) {
        content.push(`${label}: ${line}`)
        return
      }
      content.push(line ? `  ${line}` : "")
    })
  }

  // Document only the immediate contents; recursive labels obscure which level a constraint belongs to.
  if (types.includes("array") && schema.items) append("Each item", schema.items)
  if ((types.includes("object") || schema.properties) && typeof schema.additionalProperties === "object") {
    const label = Object.keys(schema.properties ?? {}).length > 0 ? "Each additional value" : "Each value"
    append(label, schema.additionalProperties)
  }

  if (content.length === 0) return ""
  const escaped = content.map((line) => line.replaceAll("*/", "* /"))
  if (escaped.length === 1 && pad.length + escaped[0].length + 7 <= 120) return `${pad}/** ${escaped[0]} */\n`
  const body = escaped.map((line) => `${pad} *${line === "" ? "" : ` ${line}`}`).join("\n")
  return `${pad}/**\n${body}\n${pad} */\n`
}

const renderSchema = (
  schema: JsonSchema,
  ctx: RenderContext,
  depth = 0,
  seen: ReadonlySet<string> = new Set(),
): string => {
  if (depth > MAX_RENDER_DEPTH) return "unknown"
  if (ctx.bigints?.has(schema)) return "bigint"
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
    if (
      alternatives.some((item) => item.type === "number") &&
      alternatives.every((item) => item.type === "number" || effectNumberSentinel(item))
    )
      return "number"
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
    if (schema.allOf.some((item) => hasUnresolvedRef(item, nested.definitions))) return "unknown"
    const members = schema.allOf.map((item) => renderSchema(item, nested, depth + 1, seen))
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

    if (properties.length === 0 && indexType === undefined) return "{}"
    const pad = "  ".repeat(depth + 1)
    const lines = properties.map((entry) => `${jsdoc(entry[1], pad)}${pad}${field(entry)},`)
    if (indexType !== undefined) lines.push(`${pad}[key: string]: ${indexType},`)
    return `{\n${lines.join("\n")}\n${"  ".repeat(depth)}}`
  }
  return "unknown"
}

const markBigInts = (ast: unknown, schema: JsonSchema, bigints: WeakSet<JsonSchema>): void => {
  if (ast === null || typeof ast !== "object" || !("_tag" in ast)) return
  if (ast._tag === "BigInt") {
    bigints.add(schema)
    return
  }
  if (ast._tag === "Objects" && "propertySignatures" in ast && Array.isArray(ast.propertySignatures)) {
    for (const field of ast.propertySignatures) {
      if (typeof field !== "object" || field === null || !("name" in field) || !("type" in field)) continue
      if (typeof field.name !== "string") continue
      const property = schema.properties?.[field.name]
      if (property !== undefined) markBigInts(field.type, property, bigints)
    }
    if ("indexSignatures" in ast && Array.isArray(ast.indexSignatures) && typeof schema.additionalProperties === "object") {
      for (const index of ast.indexSignatures) {
        if (typeof index === "object" && index !== null && "type" in index) {
          markBigInts(index.type, schema.additionalProperties, bigints)
        }
      }
    }
    return
  }
  if (ast._tag === "Arrays" && "rest" in ast && Array.isArray(ast.rest) && schema.items !== undefined) {
    for (const item of ast.rest) markBigInts(item, schema.items, bigints)
    return
  }
  if (ast._tag === "Union" && "types" in ast && Array.isArray(ast.types)) {
    const alternatives = schema.anyOf ?? schema.oneOf
    if (alternatives === undefined) return
    for (const [index, item] of ast.types.entries()) {
      const alternative = alternatives[index]
      if (alternative !== undefined) markBigInts(item, alternative, bigints)
    }
  }
}

export const toTypeScript = (schema: Schema.Top, decoded = false, pretty = false): string => {
  try {
    const visible = decoded ? Schema.toType(schema) : Schema.toEncoded(schema)
    const document = Schema.toJsonSchemaDocument(visible) as {
      readonly schema: JsonSchema
      readonly definitions?: Readonly<Record<string, JsonSchema>>
    }
    const bigints = new WeakSet<JsonSchema>()
    markBigInts(visible.ast, document.schema, bigints)
    return renderSchema(document.schema, { definitions: document.definitions ?? {}, pretty, bigints })
  } catch {
    return "unknown"
  }
}

export const jsonSchemaToTypeScript = (schema: JsonSchema, pretty = false): string => {
  try {
    return renderSchema(schema, { definitions: {}, pretty })
  } catch {
    return "unknown"
  }
}

export type InputProperty = {
  readonly name: string
  readonly description: string | undefined
  readonly required: boolean
}

export const inputProperties = <R>(tool: Tool<R>): Array<InputProperty> => {
  try {
    const document = isEffectSchema(tool.input)
      ? (Schema.toJsonSchemaDocument(tool.input) as {
          readonly schema: JsonSchema
          readonly definitions?: Readonly<Record<string, JsonSchema>>
        })
      : {
          schema: tool.input,
          definitions: { ...(tool.input.definitions ?? {}), ...(tool.input.$defs ?? {}) },
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

export const inputTypeScript = <R>(tool: Tool<R>, pretty = false): string =>
  isEffectSchema(tool.input) ? toTypeScript(tool.input, false, pretty) : jsonSchemaToTypeScript(tool.input, pretty)

export const outputTypeScript = <R>(tool: Tool<R>, pretty = false): string =>
  tool.output === undefined
    ? "void"
    : isEffectSchema(tool.output)
      ? toTypeScript(tool.output, true, pretty)
      : jsonSchemaToTypeScript(tool.output, pretty)

export const decodeInput = <R>(tool: Tool<R>, value: unknown): unknown =>
  isEffectSchema(tool.input) ? Schema.decodeUnknownSync(tool.input)(value) : value

export const decodeOutput = <R>(tool: Tool<R>, value: unknown): unknown =>
  tool.output === undefined
    ? undefined
    : isEffectSchema(tool.output)
      ? Schema.decodeUnknownSync(tool.output)(value)
      : value
