export * as Tool from "./tool.js"

import { Effect, JsonSchema, Schema } from "effect"
import type { StandardSchemaV1 } from "@standard-schema/spec"
import type { Agent } from "./agent.js"
import type { Automation } from "./automation.js"
import type { Session } from "./session.js"
import type { SessionMessage } from "./session-message.js"

export type Metadata = Readonly<Record<string, any>>

/**
 * Optional wire encoding of a tool's single required string field. Execution still receives the object.
 *
 * The `lark` form with `options` also allows optional fields besides `field`: the model writes them as JSON on a
 * first line that starts with `options.prefix`, then `field`'s raw value. The grammar for that line is derived from
 * the optional fields' schemas; `grammar`, when given, constrains the raw value and must define a `body` rule.
 * `options.description` tells the model how to write the line, and is only sent with this encoding.
 */
export const Freeform = Schema.Union([
  Schema.Struct({ type: Schema.Literal("text") }),
  Schema.Struct({ type: Schema.Literal("regex"), pattern: Schema.String }),
  // Before the plain `lark` form, which would otherwise match a grammar with options and drop them.
  Schema.Struct({
    type: Schema.Literal("lark"),
    field: Schema.String,
    options: Schema.Struct({ prefix: Schema.String, description: Schema.String }),
    grammar: Schema.optionalKey(Schema.String),
  }),
  Schema.Struct({ type: Schema.Literal("lark"), grammar: Schema.String }),
]).annotate({ identifier: "Tool.Freeform" })
export type Freeform = typeof Freeform.Type

export const FreeformFormat = Schema.Literals(["text", "regex", "lark"]).annotate({
  identifier: "Tool.FreeformFormat",
})

export const CallID = Schema.String.pipe(Schema.brand("Tool.CallID"))
export type CallID = typeof CallID.Type

export interface Context {
  readonly sessionID: Session.ID
  readonly agent: Agent.ID
  readonly messageID: SessionMessage.ID
  readonly id: CallID
  readonly progress: (update: Metadata) => Effect.Effect<void>
  /**
   * Completes when the user asks the call to stop. A tool that awaits it can stop its work and fail with what it
   * has; a tool that does not is interrupted.
   */
  readonly cancel?: Effect.Effect<void>
  /** True when the tool is invoked from inside Code Mode (`execute`). */
  readonly codemode?: boolean
  /**
   * Set when an automation's code makes the call. No model waits on it, and nobody hears about work it leaves
   * running, so a tool must finish its work within the call.
   */
  readonly automation?: { readonly id: Automation.ID }
}

export interface Namespace {
  readonly name: string
  readonly description: string
}

export interface Options<
  CMInput extends ValueSchema<any> = ValueSchema<any>,
  CMOutput extends ValueSchema<any> | undefined = ValueSchema<any> | undefined,
> {
  readonly namespace?: string
  readonly permission?: string
  readonly codemode?:
    | boolean
    | {
        readonly pinned?: boolean
        readonly description?: string
        readonly input?: CMInput
        readonly output?: CMOutput
      }
  /** @deprecated Use `codemode.pinned` instead. Removed in the next minor. */
  readonly pinned?: boolean
}

export type ValueSchema<A = unknown> = Schema.Codec<A, any> | StandardSchemaV1<any, A> | JsonSchema.JsonSchema

type InputValue<S> = 0 extends 1 & S
  ? any
  : S extends Schema.Codec<infer A, any>
    ? A
    : S extends StandardSchemaV1<any, infer A>
      ? A
      : unknown
type OutputValue<S> = 0 extends 1 & S
  ? any
  : S extends undefined
    ? never
    : S extends Schema.Codec<infer A, any>
      ? A
      : S extends StandardSchemaV1<infer A, any>
        ? A
        : any

export class Error extends Schema.TaggedError<Error>()("Tool.Error", {
  message: Schema.String,
  error: Schema.optional(Schema.Defect()),
  metadata: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
}) {}

export interface TextContent extends Schema.Schema.Type<typeof TextContent> {}
export const TextContent = Schema.Struct({
  type: Schema.Literal("text"),
  text: Schema.String,
}).annotate({ identifier: "Tool.TextContent" })

export interface FileContent extends Schema.Schema.Type<typeof FileContent> {}
export const FileContent = Schema.Struct({
  type: Schema.Literal("file"),
  uri: Schema.String,
  mime: Schema.String,
  name: Schema.optional(Schema.String),
}).annotate({ identifier: "Tool.FileContent" })

export const Content = Schema.Union([TextContent, FileContent])
  .pipe(Schema.toTaggedUnion("type"))
  .annotate({ identifier: "Tool.Content" })
export type Content = Schema.Schema.Type<typeof Content>

export interface Result<Output extends ValueSchema<any> | undefined = ValueSchema<any> | undefined> {
  readonly output?: OutputValue<Output>
  readonly content?: string | ReadonlyArray<Content>
  readonly metadata?: Metadata
}

export type Info<
  Input extends ValueSchema<any> = ValueSchema<any>,
  Output extends ValueSchema<any> | undefined = ValueSchema<any> | undefined,
  CMInput extends ValueSchema<any> = Input,
  CMOutput extends ValueSchema<any> | undefined = Output,
> = {
  readonly name: string
  readonly input: Input
  readonly freeform?: Freeform
  readonly description: string
  readonly execute: (
    input: InputValue<Input> | InputValue<CMInput>,
    context: Context,
  ) => Effect.Effect<Result<Output | CMOutput>, Error>
  readonly output?: Output
  readonly options?: Options<CMInput, CMOutput>
}
