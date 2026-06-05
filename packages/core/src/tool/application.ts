export * as ApplicationTool from "./application"

import { Tool as LLMTool, ToolFailure } from "@opencode-ai/llm"
import { Effect, Schema } from "effect"
import type { SessionSchema } from "../session/schema"
import type { ToolRegistry } from "./registry"

const TypeId: unique symbol = Symbol.for("@opencode/ApplicationTool")
const entries = new WeakMap<object, ToolRegistry.Entry<any, any>>()

export interface Context {
  readonly sessionID: SessionSchema.ID
  readonly id: string
  readonly name: string
}

export type SchemaType<A> = Schema.Codec<A, any, never, never>

export interface Tool<Parameters extends SchemaType<any>, Success extends SchemaType<any>> {
  readonly [TypeId]: {
    readonly parameters: Parameters
    readonly success: Success
  }
}

export type Any = Tool<any, any>

export const Failure = ToolFailure
export type Failure = ToolFailure

export type Content =
  | { readonly type: "text"; readonly text: string }
  | {
      readonly type: "file"
      readonly data: string
      readonly mime: string
      readonly name?: string
    }

export function make<Parameters extends SchemaType<any>, Success extends SchemaType<any>>(config: {
  readonly description: string
  readonly parameters: Parameters
  readonly success: Success
  readonly execute: (
    parameters: Schema.Schema.Type<Parameters>,
    context: Context,
  ) => Effect.Effect<Schema.Schema.Type<Success>, ToolFailure>
  readonly toModelOutput?: (input: {
    readonly callID: string
    readonly parameters: Schema.Schema.Type<Parameters>
    readonly output: Success["Encoded"]
  }) => ReadonlyArray<Content>
}): Tool<Parameters, Success> {
  const tool: Tool<Parameters, Success> = {
    [TypeId]: { parameters: config.parameters, success: config.success },
  }
  entries.set(tool, {
    tool: LLMTool.make({
      description: config.description,
      parameters: config.parameters,
      success: config.success,
      toModelOutput: config.toModelOutput
        ? (input) =>
            config.toModelOutput!(input).map((content) =>
              content.type === "text"
                ? content
                : {
                    type: "file",
                    source: { type: "data", data: content.data },
                    mime: content.mime,
                    name: content.name,
                  },
            )
        : undefined,
    }),
    execute: ({ parameters, sessionID, call }) =>
      config.execute(parameters, { sessionID, id: call.id, name: call.name }),
  })
  return tool
}

export const entry = (tool: Any): ToolRegistry.Entry<any, any> => entries.get(tool)!
