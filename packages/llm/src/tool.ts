import { Effect, Schema } from "effect"
import type { ToolDefinition as ToolDefinitionClass } from "./schema"
import { ToolDefinition, ToolFailure } from "./schema"

/**
 * A type-safe LLM tool. Each tool bundles its own description, parameter
 * Schema, success Schema, and execute handler. The handler closes over any
 * services it needs at construction time, so the runtime never sees per-tool
 * dependencies.
 *
 * Errors must be expressed as `ToolFailure`. Unmapped errors and defects fail
 * the stream.
 */
export interface Tool<Parameters extends Schema.Top, Success extends Schema.Top> {
  readonly description: string
  readonly parameters: Parameters
  readonly success: Success
  readonly execute: (
    params: Schema.Schema.Type<Parameters>,
  ) => Effect.Effect<Schema.Schema.Type<Success>, ToolFailure>
}

/**
 * Helper that returns its argument unchanged. Its only purpose is to give
 * TypeScript the inference points for `parameters` / `success` / `execute` at
 * the call site so consumers don't have to spell out the type parameters.
 *
 * ```ts
 * const getWeather = tool({
 *   description: "Get current weather",
 *   parameters: Schema.Struct({ city: Schema.String }),
 *   success: Schema.Struct({ temperature: Schema.Number }),
 *   execute: ({ city }) => Effect.succeed({ temperature: 22 }),
 * })
 * ```
 */
export const tool = <Parameters extends Schema.Top, Success extends Schema.Top>(
  config: Tool<Parameters, Success>,
): Tool<Parameters, Success> => config

/**
 * A record of named tools. The record key becomes the tool name on the wire.
 */
export type Tools = Record<string, Tool<any, any>>

/**
 * Convert a tools record into the `ToolDefinition[]` shape that
 * `LLMRequest.tools` expects. The runtime calls this internally; consumers
 * that build `LLMRequest` themselves can use it too.
 */
export const toDefinitions = (tools: Tools): ReadonlyArray<ToolDefinitionClass> =>
  Object.entries(tools).map(([name, item]) =>
    new ToolDefinition({
      name,
      description: item.description,
      inputSchema: Schema.toJsonSchemaDocument(item.parameters).schema as Record<string, unknown>,
    }),
  )

export { ToolFailure }

export * as Tool from "./tool"
