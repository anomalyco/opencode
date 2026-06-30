import { Effect, Schema } from "effect"

export type Definition<R = never> = {
  readonly _tag: "RuneTool"
  readonly description: string
  readonly input: Schema.Decoder<unknown>
  readonly output: Schema.Decoder<unknown>
  readonly run: (input: unknown) => Effect.Effect<unknown, unknown, R>
}

export type Options<I extends Schema.Decoder<unknown>, O extends Schema.Decoder<unknown>, R = never> = {
  readonly description: string
  readonly input: I
  readonly output: O
  readonly run: (input: I["Type"]) => Effect.Effect<O["Encoded"], unknown, R>
}

export const isDefinition = <R = never>(value: unknown): value is Definition<R> =>
  typeof value === "object" && value !== null && "_tag" in value && value._tag === "RuneTool"

type JsonSchema = {
  readonly type?: string | ReadonlyArray<string>
  readonly enum?: ReadonlyArray<unknown>
  readonly const?: unknown
  readonly anyOf?: ReadonlyArray<JsonSchema>
  readonly oneOf?: ReadonlyArray<JsonSchema>
  readonly properties?: Readonly<Record<string, JsonSchema>>
  readonly required?: ReadonlyArray<string>
  readonly items?: JsonSchema
  readonly additionalProperties?: boolean | JsonSchema
  readonly $ref?: string
}

const renderLiteral = (value: unknown): string => JSON.stringify(value) ?? "unknown"

const renderSchema = (schema: JsonSchema, definitions: Readonly<Record<string, JsonSchema>>): string => {
  if (schema.$ref) {
    const name = schema.$ref.split("/").pop()
    return name && definitions[name] ? renderSchema(definitions[name], definitions) : name ?? "unknown"
  }
  if (schema.const !== undefined) return renderLiteral(schema.const)
  if (schema.enum) return schema.enum.map(renderLiteral).join(" | ")
  const alternatives = schema.anyOf ?? schema.oneOf
  if (alternatives) {
    if (alternatives.some((item) => item.type === "number")) return "number"
    return alternatives.map((item) => renderSchema(item, definitions)).join(" | ")
  }
  if (Array.isArray(schema.type)) return schema.type.map((item) => renderSchema({ type: item }, definitions)).join(" | ")
  if (schema.type === "string") return "string"
  if (schema.type === "number" || schema.type === "integer") return "number"
  if (schema.type === "boolean") return "boolean"
  if (schema.type === "null") return "null"
  if (schema.type === "array") return `Array<${renderSchema(schema.items ?? {}, definitions)}>`
  if (schema.type === "object" || schema.properties) {
    const required = new Set(schema.required ?? [])
    const fields = Object.entries(schema.properties ?? {}).map(([name, value]) =>
      `${name}${required.has(name) ? "" : "?"}: ${renderSchema(value, definitions)}`)
    if (schema.additionalProperties && typeof schema.additionalProperties === "object") {
      fields.push(`[key: string]: ${renderSchema(schema.additionalProperties, definitions)}`)
    }
    return `{ ${fields.join("; ")} }`
  }
  return "unknown"
}

export const toTypeScript = (schema: Schema.Top, decoded = false): string => {
  const visible = decoded ? Schema.toType(schema) : schema
  const document = Schema.toJsonSchemaDocument(visible) as {
    readonly schema: JsonSchema
    readonly definitions?: Readonly<Record<string, JsonSchema>>
  }
  return renderSchema(document.schema, document.definitions ?? {})
}

/**
 * Defines one schema-described capability available to a Rune Program through `tools.*`.
 *
 * `input` is decoded before `run` is invoked. `run` returns the encoded representation of
 * `output`, which Rune decodes before returning it to the program. The host capability remains
 * responsible for authorization and durable side-effect handling.
 *
 * @example
 * ```ts
 * const lookup = Tool.make({
 *   description: "Look up an order",
 *   input: Schema.Struct({ id: Schema.String }),
 *   output: Schema.Struct({ status: Schema.String }),
 *   run: ({ id }) => Effect.succeed({ status: "open" }),
 * })
 * ```
 */
export const make = <I extends Schema.Decoder<unknown>, O extends Schema.Decoder<unknown>, R>(options: Options<I, O, R>): Definition<R> => ({
  _tag: "RuneTool",
  description: options.description,
  input: options.input,
  output: options.output,
  run: (input) => options.run(input as I["Type"]),
})

export * as Tool from "./tool.js"
