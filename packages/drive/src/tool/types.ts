import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
import { Backend } from "@opencode-ai/protocol/simulation"

const PositiveInt = Schema.Number.check(Schema.isInt(), Schema.isGreaterThan(0))

export const ShellInput = Schema.Struct({
  command: Schema.String.annotate({ description: "Shell command string to execute" }),
  workdir: Schema.optional(Schema.String).annotate({
    description: "Working directory. Defaults to the active Location; relative paths resolve from that Location.",
  }),
  timeout: Schema.optional(
    Schema.Number.check(Schema.isFinite(), Schema.isGreaterThanOrEqualTo(0), Schema.isLessThanOrEqualTo(600_000)),
  ).annotate({ description: "Optional timeout in milliseconds. Zero means unlimited. May not exceed 600000." }),
  background: Schema.optional(Schema.Boolean).annotate({ description: "Run the command in the background." }),
})
export interface ShellInput extends Schema.Schema.Type<typeof ShellInput> {}

export const ShellResult = Schema.Struct({
  output: Schema.String,
  exit: Schema.optional(Schema.Number),
  shellID: Schema.optional(Schema.String),
  truncated: Schema.optional(Schema.Boolean),
  timeout: Schema.optional(Schema.Boolean),
  status: Schema.optional(Schema.Literals(["completed", "running"])),
  warnings: Schema.optional(Schema.Array(Schema.String)),
})
export interface ShellResult extends Schema.Schema.Type<typeof ShellResult> {}

export const WebFetchInput = Schema.Struct({
  url: Schema.String.annotate({ description: "The HTTP or HTTPS URL to fetch content from" }),
  format: Schema.Literals(["text", "markdown", "html"])
    .annotate({ description: "The format to return the content in. Defaults to markdown." })
    .pipe(Schema.withDecodingDefault(Effect.succeed("markdown" as const))),
  timeout: Schema.optional(Schema.Number.check(Schema.isGreaterThan(0), Schema.isLessThanOrEqualTo(120))).annotate({
    description: "Optional timeout in seconds (maximum: 120)",
  }),
})
export interface WebFetchInput extends Schema.Schema.Type<typeof WebFetchInput> {}

export const WebFetchResult = Schema.Struct({
  output: Schema.String,
  url: Schema.optional(Schema.String),
  contentType: Schema.optional(Schema.String),
  format: Schema.optional(Schema.Literals(["text", "markdown", "html"])),
})
export interface WebFetchResult extends Schema.Schema.Type<typeof WebFetchResult> {}

export const WebSearchInput = Schema.Struct({
  query: Schema.String.annotate({ description: "Websearch query" }),
  numResults: Schema.optional(PositiveInt.check(Schema.isLessThanOrEqualTo(20))),
  livecrawl: Schema.optional(Schema.Literals(["fallback", "preferred"])),
  type: Schema.optional(Schema.Literals(["auto", "fast", "deep"])),
  contextMaxCharacters: Schema.optional(PositiveInt.check(Schema.isLessThanOrEqualTo(50_000))),
})
export interface WebSearchInput extends Schema.Schema.Type<typeof WebSearchInput> {}

export const WebSearchResult = Schema.Struct({
  output: Schema.String,
  provider: Schema.optional(Schema.Literals(["exa", "parallel"])),
})
export interface WebSearchResult extends Schema.Schema.Type<typeof WebSearchResult> {}

export const WriteInput = Schema.Struct({
  path: Schema.String.annotate({ description: "Path to the file to write to" }),
  content: Schema.String.annotate({ description: "Content to write to the file" }),
})
export interface WriteInput extends Schema.Schema.Type<typeof WriteInput> {}

export const WriteResult = Schema.Struct({
  output: Schema.String,
})
export interface WriteResult extends Schema.Schema.Type<typeof WriteResult> {}

export class Failure extends Schema.TaggedErrorClass<Failure>()("OpenCodeDrive.ToolFailure", {
  message: Schema.String,
}) {}

export const Name = Schema.Literals(["shell", "webfetch", "websearch", "write"])
export type Name = typeof Name.Type
export const Names = Schema.Array(Name)

export class ControlError extends Schema.TaggedErrorClass<ControlError>()("OpenCodeDrive.ToolControlError", {
  operation: Schema.Literals(["control", "take", "progress", "succeed", "fail"]),
  reason: Schema.Literals([
    "not-controlled",
    "controller-closed",
    "already-claimed",
    "already-settled",
    "transport-interrupted",
  ]),
  name: Name,
  callID: Schema.optional(Schema.String),
  message: Schema.String,
}) {}

export interface Context<Input, Result> {
  readonly id: string
  readonly input: Input
  /** Zero-based invocation index for this handler. */
  readonly index: number
  readonly progress: (output: string | Result) => Effect.Effect<void>
}

export type Handler<Input, Result> = (context: Context<Input, Result>) => Effect.Effect<Result, Failure>

export type ShellHandler = Handler<ShellInput, ShellResult>
export type WebFetchHandler = Handler<WebFetchInput, WebFetchResult>
export type WebSearchHandler = Handler<WebSearchInput, WebSearchResult>
export type WriteHandler = Handler<WriteInput, WriteResult>

export interface ToolTypes {
  readonly shell: { readonly input: ShellInput; readonly result: ShellResult }
  readonly webfetch: { readonly input: WebFetchInput; readonly result: WebFetchResult }
  readonly websearch: { readonly input: WebSearchInput; readonly result: WebSearchResult }
  readonly write: { readonly input: WriteInput; readonly result: WriteResult }
}

export type HandlerFor<Tool extends Name> = Handler<ToolTypes[Tool]["input"], ToolTypes[Tool]["result"]>

export type Registration = {
  readonly [Tool in Name]: readonly [name: Tool, handler: HandlerFor<Tool>]
}[Name]

export interface Registry {
  handle<Tool extends Name>(name: Tool, handler: HandlerFor<Tool>): void
}

export type Setup = (tools: Registry) => void

export type Configuration = Setup | typeof Names.Type

export interface ControlledCall<Input, Result> {
  readonly id: string
  readonly input: Input
  readonly index: number
  readonly progress: (output: string | Result) => Effect.Effect<void, ControlError>
  readonly succeed: (result: Result) => Effect.Effect<void, ControlError>
  /** Commits a failed remote tool result; this Effect fails only when control is no longer available. */
  readonly fail: (message: string) => Effect.Effect<void, ControlError>
  /** Completes only when interruption wins before `succeed` or `fail`. */
  readonly awaitInterrupted: () => Effect.Effect<void>
}

export interface ControlledCalls<Input, Result> {
  take(): Effect.Effect<ControlledCall<Input, Result>, ControlError>
  take(id: string): Effect.Effect<ControlledCall<Input, Result>, ControlError>
}

export type ControlledCallsFor<Tool extends Name> = ControlledCalls<ToolTypes[Tool]["input"], ToolTypes[Tool]["result"]>

export interface StaticControls {
  control<Tool extends Name>(name: Tool): Effect.Effect<ControlledCallsFor<Tool>, ControlError>
}

export type Content = Backend.ToolContent
export type DynamicRegistration = Backend.ToolRegistration
export type AttachParams = Backend.ToolAttachParams
export const Progress = Schema.Struct({
  structured: Schema.Record(Schema.String, Schema.Json),
  content: Schema.optionalKey(Schema.Array(Backend.ToolContent)),
})
export interface Progress extends Schema.Schema.Type<typeof Progress> {}
export type Output = Backend.ToolOutput
export type Cancellation = Backend.ToolCancellation

export class LifecycleError extends Schema.TaggedErrorClass<LifecycleError>()("OpenCodeDrive.ToolLifecycleError", {
  operation: Schema.Literals(["attach", "take", "progress", "finish", "fail"]),
  reason: Schema.Literals([
    "controller-closed",
    "already-claimed",
    "already-settled",
    "cancelled",
    "rejected",
    "transport-interrupted",
  ]),
  callID: Schema.optional(Schema.String),
  message: Schema.String,
}) {}

export interface Invocation {
  /** Producer invocation ID, stable across controller reconnects. */
  readonly id: string
  /** Effective provider-visible name, including any flattened namespace. */
  readonly name: string
  readonly input: Backend.ToolInvocation["input"]
  readonly context: Omit<Backend.ToolInvocation["context"], "id"> & { readonly callID: string }
  readonly progress: (update: Progress) => Effect.Effect<void, LifecycleError>
  readonly finish: (output: Output) => Effect.Effect<void, LifecycleError>
  readonly fail: (message: string) => Effect.Effect<void, LifecycleError>
  /** Completes only when OpenCode cancels before `finish` or `fail`. */
  readonly awaitCancelled: () => Effect.Effect<Cancellation>
}

export interface DynamicControls {
  /** Atomically replaces the complete provider-backed dynamic tool set. */
  readonly attach: (params: AttachParams) => Effect.Effect<void, LifecycleError>
  take(): Effect.Effect<Invocation, LifecycleError>
  take(callID: string): Effect.Effect<Invocation, LifecycleError>
}

export interface Controls extends StaticControls, DynamicControls {}
