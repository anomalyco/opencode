export * as Tool from "./tool.js"

import { Effect, JsonSchema, Schema } from "effect"
import type { StandardSchemaV1 } from "@standard-schema/spec"
import type { Agent } from "./agent.js"
import type { Session } from "./session.js"
import type { SessionMessage } from "./session-message.js"

export type Metadata = Readonly<Record<string, any>>

/** Optional wire encoding of a tool's single required string field. Execution still receives the object. */
export const Freeform = Schema.Union([
  Schema.Struct({ type: Schema.Literal("text") }),
  Schema.Struct({ type: Schema.Literal("regex"), pattern: Schema.String }),
  Schema.Struct({ type: Schema.Literal("lark"), grammar: Schema.String }),
]).annotate({ identifier: "Tool.Freeform" })
export type Freeform = typeof Freeform.Type

export const FreeformFormat = Schema.Literals(Freeform.members.map((member) => member.fields.type.literal)).annotate({
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
  readonly codeMode?: boolean
}

export interface Namespace {
  readonly name: string
  readonly description: string
}

export interface Options {
  readonly namespace?: string
  readonly permission?: string
  readonly codemode?: boolean
  readonly pinned?: boolean
}

export type ValueSchema<A = unknown> = Schema.Codec<A, any> | StandardSchemaV1<any, A> | JsonSchema.JsonSchema

/** A tool field that may depend on whether the tool is shown or run inside Code Mode. */
export type Dynamic<T> = T | ((codeMode: boolean) => T)

type SchemaInput<S> = S extends Schema.Codec<infer A, any> ? A : S extends StandardSchemaV1<any, infer A> ? A : unknown

type SchemaOutput<S> = S extends undefined
  ? never
  : S extends Schema.Codec<infer A, any>
    ? A
    : S extends StandardSchemaV1<infer A, any>
      ? A
      : any

type InputValue<S> = 0 extends 1 & S ? any : SchemaInput<S>
type OutputValue<S> = 0 extends 1 & S ? any : SchemaOutput<S>

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
> = {
  readonly name: string
  readonly input: Dynamic<Input>
  readonly freeform?: Freeform
  readonly description: Dynamic<string>
  readonly execute: (input: InputValue<Input>, context: Context) => Effect.Effect<Result<Output>, Error>
  readonly output?: Dynamic<Output>
  readonly options?: Options
}

export type Resolved<
  Input extends ValueSchema<any> = ValueSchema<any>,
  Output extends ValueSchema<any> | undefined = ValueSchema<any> | undefined,
> = Omit<Info<Input, Output>, "description" | "input" | "output"> & {
  readonly description: string
  readonly input: Input
  readonly output?: Output
}
