import { Effect, Schema } from "effect"

/**
 * JSON Schema subset accepted for render-only tool schemas.
 *
 * A JSON-Schema-described side of a tool is used to generate the model-visible TypeScript
 * signature only - CodeMode performs no validation against it. This is the natural shape for
 * adapter-provided tools (e.g. MCP definitions) whose schemas arrive as JSON Schema documents.
 */
export type JsonSchema = {
  readonly type?: string | ReadonlyArray<string>
  readonly enum?: ReadonlyArray<unknown>
  readonly const?: unknown
  readonly anyOf?: ReadonlyArray<JsonSchema>
  readonly oneOf?: ReadonlyArray<JsonSchema>
  readonly properties?: Readonly<Record<string, JsonSchema>>
  readonly required?: ReadonlyArray<string>
  readonly items?: JsonSchema
  readonly additionalProperties?: boolean | JsonSchema
  readonly description?: string
  readonly default?: unknown
  readonly format?: string
  readonly deprecated?: boolean
  readonly minItems?: number
  readonly maxItems?: number
  readonly $ref?: string
  readonly $defs?: Readonly<Record<string, JsonSchema>>
  readonly definitions?: Readonly<Record<string, JsonSchema>>
}

/** Either a validating Effect Schema or a render-only JSON Schema document. */
export type ToolSchema = Schema.Decoder<unknown> | JsonSchema

/** Schema-backed tool definition consumed by a CodeMode tool tree. */
export type Definition<R = never> = {
  readonly _tag: "CodeModeTool"
  readonly description: string
  readonly input: ToolSchema
  readonly output: ToolSchema | undefined
  readonly run: (input: unknown) => Effect.Effect<unknown, unknown, R>
}

/** The value `run` receives: the decoded type for Effect Schemas, `unknown` for JSON Schemas. */
export type InputType<S> = S extends Schema.Decoder<unknown> ? S["Type"] : unknown

/** The value `run` returns: the encoded type for Effect Schemas, `unknown` otherwise. */
export type ResultType<S> = S extends Schema.Decoder<unknown> ? S["Encoded"] : unknown

/** Options for defining one CodeMode tool. */
export type Options<I extends ToolSchema, O extends ToolSchema | undefined, R = never> = {
  readonly description: string
  readonly input: I
  readonly output?: O
  readonly run: (input: InputType<I>) => Effect.Effect<ResultType<O>, unknown, R>
}

export const isDefinition = <R = never>(value: unknown): value is Definition<R> =>
  typeof value === "object" && value !== null && "_tag" in value && value._tag === "CodeModeTool"

const isEffectSchema = (schema: ToolSchema): schema is Schema.Decoder<unknown> & Schema.Top => Schema.isSchema(schema)

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
  if (schema.$ref) {
    const name = schema.$ref.split("/").pop()
    if (!name || !ctx.definitions[name]) return name ?? "unknown"
    if (seen.has(name)) return name // recursive type: reference by name rather than loop
    return renderSchema(ctx.definitions[name], ctx, depth, new Set([...seen, name]))
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
    return alternatives.map((item) => renderSchema(item, ctx, depth + 1, seen)).join(" | ")
  }
  if (Array.isArray(schema.type)) {
    return schema.type.map((item) => renderSchema({ type: item }, ctx, depth + 1, seen)).join(" | ")
  }
  if (schema.type === "string") return "string"
  if (schema.type === "number" || schema.type === "integer") return "number"
  if (schema.type === "boolean") return "boolean"
  if (schema.type === "null") return "null"
  if (schema.type === "array") return `Array<${renderSchema(schema.items ?? {}, ctx, depth + 1, seen)}>`
  if (schema.type === "object" || schema.properties) {
    const required = new Set(schema.required ?? [])
    const properties = Object.entries(schema.properties ?? {})
    const additional = schema.additionalProperties
    const indexType =
      additional && typeof additional === "object" ? renderSchema(additional, ctx, depth + 1, seen) : undefined
    const field = ([name, value]: readonly [string, JsonSchema]) =>
      `${renderKey(name)}${required.has(name) ? "" : "?"}: ${renderSchema(value, ctx, depth + 1, seen)}`

    if (!ctx.pretty) {
      const fields = properties.map(field)
      if (indexType !== undefined) fields.push(`[key: string]: ${indexType}`)
      return fields.length === 0 ? "{}" : `{ ${fields.join("; ")} }`
    }

    // Pretty: an indented block, each described field preceded by its JSDoc comment.
    if (properties.length === 0 && indexType === undefined) return "{}"
    const pad = "  ".repeat(depth + 1)
    const lines = properties.map(
      (entry) => `${jsdoc(entry[1].description, docTags(entry[1]), pad)}${pad}${field(entry)}`,
    )
    if (indexType !== undefined) lines.push(`${pad}[key: string]: ${indexType}`)
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
      const name = schema.$ref.split("/").pop()
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

/**
 * Defines one schema-described tool available to a CodeMode program through `tools.*`.
 *
 * `input` and `output` each accept a validating Effect Schema or a render-only JSON Schema
 * document. Effect Schema input is decoded before `run` is invoked, and `run` returns the
 * encoded representation of an Effect Schema `output`, which CodeMode decodes before returning
 * it to the program. JSON Schemas only shape the model-visible signature; values pass through
 * unvalidated. `output` is optional - without it the signature advertises `unknown` and the
 * host result is exposed as-is. The host tool remains responsible for authorization and
 * durable side-effect handling.
 *
 * @example
 * ```ts
 * const lookup = Tool.make({
 *   description: "Look up an order",
 *   input: Schema.Struct({ id: Schema.String }),
 *   output: Schema.Struct({ status: Schema.String }),
 *   run: ({ id }) => Effect.succeed({ status: "open" }),
 * })
 *
 * const fromJsonSchema = Tool.make({
 *   description: "Call an adapter-described tool",
 *   input: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
 *   run: (input) => callHost(input),
 * })
 * ```
 */
export const make = <I extends ToolSchema, const O extends ToolSchema | undefined = undefined, R = never>(
  options: Options<I, O, R>,
): Definition<R> => ({
  _tag: "CodeModeTool",
  description: options.description,
  input: options.input,
  output: options.output,
  run: (input) => options.run(input as InputType<I>),
})

/** Constructors for schema-backed tools exposed inside CodeMode programs. */
export const Tool = { make, isDefinition }
