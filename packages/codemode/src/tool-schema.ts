import { JsonPointer, Schema } from "effect"
import type { Tool, JsonSchema, SchemaType } from "./tool.js"

const isEffectSchema = (schema: SchemaType): schema is Schema.Decoder<unknown> & Schema.Top => Schema.isSchema(schema)

export type Language = "javascript" | "lua"

export const identifierSegment = /^[A-Za-z_$][A-Za-z0-9_$]*$/

const luaKeywords = new Set(
  "and break do else elseif end false for function if in local nil not or repeat return then true until while".split(
    " ",
  ),
)

// Lua 5.1 uses decimal byte escapes, not JSON's \uXXXX escapes. Three digits avoid swallowing a following digit.
const luaString = (text: string) =>
  `"${text.replace(/["\\\x00-\x1f\x7f]/g, (char) =>
    char === '"' || char === "\\" ? `\\${char}` : `\\${char.charCodeAt(0).toString().padStart(3, "0")}`,
  )}"`

const luaKey = (name: string) =>
  /^[A-Za-z_][A-Za-z0-9_]*$/.test(name) && !luaKeywords.has(name) ? name : `[${luaString(name)}]`

export const member = (name: string, language: Language): string => {
  if (language === "lua") {
    const key = luaKey(name)
    return key === name ? `.${name}` : key
  }
  return identifierSegment.test(name) ? `.${name}` : `[${JSON.stringify(name)}]`
}

const renderLiteral = (value: unknown, language: Language): string => {
  if (language === "lua") {
    if (value === null) return "json.null"
    if (typeof value === "string") return luaString(value)
    if (Array.isArray(value) && value.length === 0) return "json.array()"
    if (Array.isArray(value)) return `{${value.map((item) => renderLiteral(item, language)).join(", ")}}`
    if (value !== null && typeof value === "object")
      return `{${Object.entries(value)
        .map(([key, item]) => `${luaKey(key)} = ${renderLiteral(item, language)}`)
        .join(", ")}}`
  }
  return JSON.stringify(value) ?? "unknown"
}

const definitionName = (ref: string): string | undefined => {
  const tokens = JsonPointer.parseUriFragment(ref)
  return tokens?.length === 2 && (tokens[0] === "$defs" || tokens[0] === "definitions") ? tokens[1] : undefined
}

// Effect encodes an unchecked `number` as `number | "Infinity" | "-Infinity" | "NaN"`, and older generators emit one
// singleton enum per value. Rendering them as plain `number` only narrows what the model is told to send.
const effectNumberSentinel = (schema: JsonSchema) =>
  schema.type === "string" &&
  Array.isArray(schema.enum) &&
  schema.enum.length > 0 &&
  schema.enum.every((value) => value === "NaN" || value === "Infinity" || value === "-Infinity")

// Effect emits `{ not: { type: "null" } }` only for a struct with no properties or index signatures. With nothing but
// annotations beside it, it is TypeScript's `{}`. Mirrors `emptyInputJsonSchema` in `@opencode/ai`, which this
// standalone package cannot import.
const annotationKeywords = new Set(["title", "description", "default", "examples", "readOnly", "writeOnly"])
const isEffectEmptyStruct = (schema: JsonSchema) =>
  schema.not?.type === "null" &&
  Object.keys(schema.not).length === 1 &&
  Object.keys(schema).every((key) => key === "not" || annotationKeywords.has(key))

const intersection = (members: ReadonlyArray<string>): string => {
  const concrete = members.filter((member) => member !== "unknown")
  if (concrete.length === 0) return "unknown"
  if (concrete.length === 1) return concrete[0]
  return concrete.map((member) => (member.includes(" | ") ? `(${member})` : member)).join(" & ")
}

const MAX_RENDER_DEPTH = 8

type RenderContext = {
  readonly language: Language
  readonly definitions: Readonly<Record<string, JsonSchema>>
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
    const name = definitionName(schema.$ref)
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

const docTags = (schema: JsonSchema, language: Language): Array<string> => {
  const tags: Array<string> = []
  if (schema.deprecated === true) tags.push("@deprecated")
  if (schema.default !== undefined) {
    try {
      const rendered = language === "lua" ? renderLiteral(schema.default, language) : JSON.stringify(schema.default)
      if (rendered !== undefined) tags.push(`@default ${rendered}`)
    } catch {}
  }
  if (typeof schema.format === "string") tags.push(`@format ${schema.format}`)
  if (schema.type === "integer") tags.push("@integer")
  const integer = schema.type === "integer"
  if (typeof schema.minimum === "number" && !(integer && schema.minimum === Number.MIN_SAFE_INTEGER))
    tags.push(`@minimum ${schema.minimum}`)
  if (typeof schema.maximum === "number" && !(integer && schema.maximum === Number.MAX_SAFE_INTEGER))
    tags.push(`@maximum ${schema.maximum}`)
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

const docLines = (schema: JsonSchema, width: number, language: Language): Array<string> => {
  const summary = docTags(schema, language).join(" ")
  const lines = (schema.description ?? "").split("\n").map((line) => line.replace(/\s+$/, ""))
  while (lines.length > 0 && lines[0]!.trim() === "") lines.shift()
  while (lines.length > 0 && lines[lines.length - 1]!.trim() === "") lines.pop()
  const inline = lines.length === 1 ? `${lines[0]}${lines[0].endsWith(".") ? "" : "."} ${summary}` : summary
  return summary && lines.length === 1 && !summary.includes("\n") && width + inline.length + 7 <= 120
    ? [inline]
    : [...lines, ...(summary ? summary.split("\n") : [])]
}

// Neutralize `*\/` so model-provided schema text cannot terminate generated documentation.
const documentation = (schema: JsonSchema, pad: string, language: Language): string => {
  const content = docLines(schema, pad.length, language)
  const types = typeof schema.type === "string" ? [schema.type] : (schema.type ?? [])

  const append = (label: string, child: JsonSchema) => {
    docLines(child, pad.length + label.length + 2, language).forEach((line, index) => {
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
  if (language === "lua") return content.map((line) => `${pad}-- ${line}\n`).join("")
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
  const nested =
    schema.definitions === undefined && schema.$defs === undefined
      ? ctx
      : { ...ctx, definitions: { ...ctx.definitions, ...(schema.definitions ?? {}), ...(schema.$defs ?? {}) } }
  if (schema.$ref) {
    const name = definitionName(schema.$ref)
    if (!name || !nested.definitions[name] || seen.has(name)) return "unknown"
    return intersection([
      renderSchema(nested.definitions[name], nested, depth, new Set([...seen, name])),
      renderSchema({ ...schema, $ref: undefined }, nested, depth + 1, seen),
    ])
  }
  if (schema.const !== undefined) return renderLiteral(schema.const, ctx.language)
  if (schema.enum) return schema.enum.map((value) => renderLiteral(value, ctx.language)).join(" | ")
  const listed = schema.anyOf ?? schema.oneOf
  const alternatives = listed?.some((item) => item.type === "number")
    ? listed.filter((item) => !effectNumberSentinel(item))
    : listed
  if (alternatives) {
    if (
      alternatives.some((item) => item.type === "number") &&
      alternatives.every((item) => item.type === "number" || effectNumberSentinel(item))
    )
      return "number"
    // Older Effect releases emitted this pair for an empty struct, and raw schemas from their generators still can.
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
  if (schema.type === "null") return ctx.language === "lua" ? "json.null" : "null"
  if (schema.type === "array") {
    const item = renderSchema(schema.items ?? {}, nested, depth + 1, seen)
    return ctx.language === "lua" ? `{ ${item}, ... }` : `Array<${item}>`
  }
  if (schema.type === "object" || schema.properties) {
    const required = new Set(schema.required ?? [])
    const properties = Object.entries(schema.properties ?? {})
    const additional = schema.additionalProperties
    const indexType =
      additional && typeof additional === "object" ? renderSchema(additional, nested, depth + 1, seen) : undefined
    const lua = ctx.language === "lua"
    const field = ([name, value]: readonly [string, JsonSchema]) => {
      const key = lua ? luaKey(name) : identifierSegment.test(name) ? name : JSON.stringify(name)
      return `${key}${required.has(name) ? "" : "?"}${lua ? " = " : ": "}${renderSchema(value, nested, depth + 1, seen)}`
    }
    const indexField = lua ? `[string] = ${indexType}` : `[key: string]: ${indexType}`

    if (!ctx.pretty) {
      const fields = properties.map(field)
      if (indexType !== undefined) fields.push(indexField)
      return fields.length === 0 ? "{}" : `{ ${fields.join(lua ? ", " : "; ")} }`
    }

    if (properties.length === 0 && indexType === undefined) return "{}"
    const pad = "  ".repeat(depth + 1)
    const lines = properties.map((entry) => `${documentation(entry[1], pad, ctx.language)}${pad}${field(entry)},`)
    if (indexType !== undefined) lines.push(`${pad}${indexField},`)
    return `{\n${lines.join("\n")}\n${"  ".repeat(depth)}}`
  }
  if (isEffectEmptyStruct(schema)) return "{}"
  return "unknown"
}

const effectType = (schema: Schema.Top, decoded: boolean, pretty: boolean, language: Language): string => {
  try {
    const document = Schema.toJsonSchemaDocument(decoded ? Schema.toType(schema) : schema, {
      onExcessProperty: "error",
    }) as {
      readonly schema: JsonSchema
      readonly definitions: Readonly<Record<string, JsonSchema>>
    }
    return renderSchema(document.schema, { definitions: document.definitions, pretty, language })
  } catch {
    return "unknown"
  }
}

const jsonType = (schema: JsonSchema, pretty: boolean, language: Language): string => {
  try {
    return renderSchema(schema, { definitions: {}, pretty, language })
  } catch {
    return "unknown"
  }
}

export const toTypeScript = (schema: Schema.Top, decoded = false, pretty = false) =>
  effectType(schema, decoded, pretty, "javascript")
export const jsonSchemaToTypeScript = (schema: JsonSchema, pretty = false) => jsonType(schema, pretty, "javascript")

export type InputProperty = {
  readonly name: string
  readonly description: string | undefined
  readonly required: boolean
}

export const inputProperties = <R>(tool: Tool<R>): Array<InputProperty> => {
  try {
    const document = isEffectSchema(tool.input)
      ? (Schema.toJsonSchemaDocument(tool.input, { onExcessProperty: "error" }) as {
          readonly schema: JsonSchema
          readonly definitions: Readonly<Record<string, JsonSchema>>
        })
      : {
          schema: tool.input,
          definitions: { ...(tool.input.definitions ?? {}), ...(tool.input.$defs ?? {}) },
        }
    let schema = document.schema
    if (schema.$ref !== undefined) {
      const name = definitionName(schema.$ref)
      const resolved = name === undefined ? undefined : document.definitions[name]
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

export const inputType = <R>(tool: Tool<R>, pretty: boolean, language: Language): string =>
  isEffectSchema(tool.input) ? effectType(tool.input, false, pretty, language) : jsonType(tool.input, pretty, language)

// Effect inputs are empty only when their encoded root is Effect's empty-struct marker, which records and checked
// structs never are. Raw JSON Schema inputs keep the `{}` rendering check, which treats `{ type: "object" }` as empty.
export const isEmptyInput = <R>(tool: Tool<R>): boolean =>
  isEffectSchema(tool.input)
    ? isEffectEmptyStruct(
        Schema.toJsonSchemaDocument(tool.input, { referencePolicy: () => undefined }).schema as JsonSchema,
      )
    : inputType(tool, false, "javascript") === "{}"

export const outputType = <R>(tool: Tool<R>, pretty: boolean, language: Language): string =>
  tool.output === undefined
    ? language === "lua"
      ? "nil"
      : "void"
    : isEffectSchema(tool.output)
      ? effectType(tool.output, true, pretty, language)
      : jsonType(tool.output, pretty, language)

export const inputTypeScript = <R>(tool: Tool<R>, pretty = false) => inputType(tool, pretty, "javascript")
export const outputTypeScript = <R>(tool: Tool<R>, pretty = false) => outputType(tool, pretty, "javascript")

export const decodeInput = <R>(tool: Tool<R>, value: unknown): unknown =>
  isEffectSchema(tool.input) ? Schema.decodeUnknownSync(tool.input)(value) : value

export const decodeOutput = <R>(tool: Tool<R>, value: unknown): unknown =>
  tool.output === undefined
    ? undefined
    : isEffectSchema(tool.output)
      ? Schema.decodeUnknownSync(tool.output)(value)
      : value
