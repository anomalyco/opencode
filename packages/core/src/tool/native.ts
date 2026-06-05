export * as NativeTool from "./native"

import { Tool, ToolFailure } from "@opencode-ai/llm"
import { Effect, Schema } from "effect"
import type { SessionSchema } from "../session/schema"

export interface Context {
  readonly sessionID: SessionSchema.ID
  readonly id: string
  readonly name: string
}

export type SchemaType<A> = Schema.Codec<A, any, never, never>

export interface Executable<Parameters extends SchemaType<any>, Success extends SchemaType<any>> {
  readonly definition: Tool.Tool<Parameters, Success>
  readonly execute: (
    parameters: Schema.Schema.Type<Parameters>,
    context: Context,
  ) => Effect.Effect<Schema.Schema.Type<Success>, ToolFailure>
}

export type Any = Executable<any, any>

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
}): Executable<Parameters, Success> {
  const toModelOutput = config.toModelOutput
  return {
    definition: Tool.make({
      description: config.description,
      parameters: config.parameters,
      success: config.success,
      toModelOutput: toModelOutput
        ? (input) =>
            toModelOutput(input).map((content) =>
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
    execute: config.execute,
  }
}
