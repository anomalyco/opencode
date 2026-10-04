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
  readonly allOf?: ReadonlyArray<JsonSchema>
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
export type SchemaType = Schema.Decoder<unknown> | JsonSchema

/** Schema-backed tool definition consumed by a CodeMode tool tree. */
export type Definition<R = never> = {
  readonly _tag: "CodeModeTool"
  readonly description: string
  readonly input: SchemaType
  readonly output: SchemaType | undefined
  readonly run: (input: unknown) => Effect.Effect<unknown, unknown, R>
}

/** The value `run` receives: the decoded type for Effect Schemas, `unknown` for JSON Schemas. */
type InputType<S> = S extends Schema.Decoder<unknown> ? S["Type"] : unknown

/** The value `run` returns: the encoded type for Effect Schemas, `unknown` otherwise. */
type ResultType<S> = S extends Schema.Decoder<unknown> ? S["Encoded"] : unknown

/** Options for defining one CodeMode tool. */
export type Options<I extends SchemaType, O extends SchemaType | undefined, R = never> = {
  readonly description: string
  readonly input: I
  readonly output?: O
  readonly run: (input: InputType<I>) => Effect.Effect<ResultType<O>, unknown, R>
}

export const isDefinition = <R = never>(value: unknown): value is Definition<R> =>
  typeof value === "object" && value !== null && "_tag" in value && value._tag === "CodeModeTool"

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
export const make = <I extends SchemaType, const O extends SchemaType | undefined = undefined, R = never>(
  options: Options<I, O, R>,
): Definition<R> => ({
  _tag: "CodeModeTool",
  description: options.description,
  input: options.input,
  output: options.output,
  run: (input) => options.run(input as InputType<I>),
})
