import { Effect, JsonSchema, Schema } from "effect"
import type { ToolDefinition as ToolDefinitionClass } from "./schema"
import { ToolDefinition, ToolFailure } from "./schema"

/**
 * Schema constraint for tool parameters / success values: no decoding or
 * encoding services are allowed. Tools should be self-contained — anything
 * beyond pure data conversion belongs in the handler closure.
 */
export type ToolSchema<T> = Schema.Codec<T, any, never, never>

export type ToolExecute<Parameters extends ToolSchema<any>, Success extends ToolSchema<any>> = (
  params: Schema.Schema.Type<Parameters>,
) => Effect.Effect<Schema.Schema.Type<Success>, ToolFailure>

/**
 * A type-safe LLM tool. Each tool bundles its own description, parameter
 * Schema and success Schema. The execute handler is optional: omit it when you
 * only want to expose a tool schema to the model and handle tool calls outside
 * this package.
 *
 * Errors must be expressed as `ToolFailure`. Unmapped errors and defects fail
 * the stream.
 *
 * Internally each tool also carries memoized codecs and a precomputed
 * `ToolDefinition` so the runtime doesn't rebuild them per invocation.
 */
export interface Tool<Parameters extends ToolSchema<any>, Success extends ToolSchema<any>> {
  readonly description: string
  readonly parameters: Parameters
  readonly success: Success
  readonly execute?: ToolExecute<Parameters, Success>
  /** @internal */
  readonly _decode: (input: unknown) => Effect.Effect<Schema.Schema.Type<Parameters>, Schema.SchemaError>
  /** @internal */
  readonly _encode: (value: Schema.Schema.Type<Success>) => Effect.Effect<unknown, Schema.SchemaError>
  /** @internal */
  readonly _definition: ToolDefinitionClass
}

export type AnyTool = Tool<ToolSchema<any>, ToolSchema<any>>

export type ExecutableTool<Parameters extends ToolSchema<any>, Success extends ToolSchema<any>> = Tool<
  Parameters,
  Success
> & {
  readonly execute: ToolExecute<Parameters, Success>
}

export type AnyExecutableTool = ExecutableTool<ToolSchema<any>, ToolSchema<any>>

export type ExecutableTools = Record<string, AnyExecutableTool>

type TypedToolConfig = {
  readonly description: string
  readonly parameters: ToolSchema<any>
  readonly success: ToolSchema<any>
  readonly execute?: ToolExecute<ToolSchema<any>, ToolSchema<any>>
}

type DynamicToolConfig = {
  readonly description: string
  readonly jsonSchema: JsonSchema.JsonSchema
  readonly execute?: (params: unknown) => Effect.Effect<unknown, ToolFailure>
}

/**
 * Constructs a tool. Two input modes:
 *
 * 1. **Typed** — pass Effect `parameters` and `success` Schemas; inputs and
 *    outputs are statically typed and decoded/encoded automatically.
 *
 *    ```ts
 *    Tool.make({
 *      description: "Get current weather",
 *      parameters: Schema.Struct({ city: Schema.String }),
 *      success: Schema.Struct({ temperature: Schema.Number }),
 *      execute: ({ city }) => Effect.succeed({ temperature: 22 }),
 *    })
 *    ```
 *
 * 2. **Dynamic** — pass raw JSON Schema as `jsonSchema`. Use this when the
 *    schema comes from an external source (MCP server, plugin manifest,
 *    dynamic config) and is not known at compile time. Inputs are typed as
 *    `unknown`; the handler is responsible for any validation it needs.
 *
 *    ```ts
 *    Tool.make({
 *      description: "Look something up",
 *      jsonSchema: { type: "object", properties: { ... } },
 *      execute: (params) => Effect.succeed(...),
 *    })
 *    ```
 *
 * In both modes the produced tool flows through `toDefinitions(...)` and the
 * runtime identically.
 */
export function make<Parameters extends ToolSchema<any>, Success extends ToolSchema<any>>(config: {
  readonly description: string
  readonly parameters: Parameters
  readonly success: Success
  readonly execute: ToolExecute<Parameters, Success>
}): ExecutableTool<Parameters, Success>
export function make<Parameters extends ToolSchema<any>, Success extends ToolSchema<any>>(config: {
  readonly description: string
  readonly parameters: Parameters
  readonly success: Success
  readonly execute?: undefined
}): Tool<Parameters, Success>
export function make(config: {
  readonly description: string
  readonly jsonSchema: JsonSchema.JsonSchema
  readonly execute: (params: unknown) => Effect.Effect<unknown, ToolFailure>
}): AnyExecutableTool
export function make(config: {
  readonly description: string
  readonly jsonSchema: JsonSchema.JsonSchema
  readonly execute?: undefined
}): AnyTool
export function make(config: TypedToolConfig | DynamicToolConfig): AnyTool {
  if ("jsonSchema" in config) {
    return {
      description: config.description,
      parameters: Schema.Unknown as ToolSchema<unknown>,
      success: Schema.Unknown as ToolSchema<unknown>,
      execute: config.execute,
      _decode: Effect.succeed,
      _encode: Effect.succeed,
      _definition: new ToolDefinition({
        name: "",
        description: config.description,
        inputSchema: config.jsonSchema,
      }),
    }
  }
  return {
    description: config.description,
    parameters: config.parameters,
    success: config.success,
    execute: config.execute,
    _decode: Schema.decodeUnknownEffect(config.parameters),
    _encode: Schema.encodeEffect(config.success),
    _definition: new ToolDefinition({
      name: "",
      description: config.description,
      inputSchema: toJsonSchema(config.parameters),
    }),
  }
}

export const tool = make

/**
 * A record of named tools. The record key becomes the tool name on the wire.
 */
export type Tools = Record<string, AnyTool>

/**
 * Convert a tools record into the `ToolDefinition[]` shape that
 * `LLMRequest.tools` expects. The runtime calls this internally; consumers
 * that build `LLMRequest` themselves can use it too.
 *
 * Tool names come from the record keys, so the per-tool cached
 * `_definition` is rebuilt with the correct name here. The JSON Schema body
 * is reused.
 */
export const toDefinitions = (tools: Tools): ReadonlyArray<ToolDefinitionClass> =>
  Object.entries(tools).map(
    ([name, item]) =>
      new ToolDefinition({
        name,
        description: item._definition.description,
        inputSchema: item._definition.inputSchema,
      }),
  )

const toJsonSchema = (schema: Schema.Top): JsonSchema.JsonSchema => {
  const document = Schema.toJsonSchemaDocument(schema)
  if (Object.keys(document.definitions).length === 0) return document.schema
  return { ...document.schema, $defs: document.definitions }
}

export { ToolFailure }

export * as Tool from "./tool"
