import { Effect, Schema } from "effect"
import type { Namespace } from "./namespace.js"
import type { Tools } from "./tools.js"

/**
 * JSON Schema subset for model-visible signatures. CodeMode does not validate values against
 * these schemas.
 */
export type JsonSchema = {
  readonly type?: string | ReadonlyArray<string>
  readonly enum?: ReadonlyArray<unknown>
  readonly const?: unknown
  readonly anyOf?: ReadonlyArray<JsonSchema>
  readonly oneOf?: ReadonlyArray<JsonSchema>
  readonly allOf?: ReadonlyArray<JsonSchema>
  readonly not?: JsonSchema
  readonly properties?: Readonly<Record<string, JsonSchema>>
  readonly required?: ReadonlyArray<string>
  readonly items?: JsonSchema
  readonly additionalProperties?: boolean | JsonSchema
  readonly description?: string
  readonly default?: unknown
  readonly format?: string
  readonly deprecated?: boolean
  readonly minimum?: number
  readonly maximum?: number
  readonly exclusiveMinimum?: number
  readonly exclusiveMaximum?: number
  readonly multipleOf?: number
  readonly minLength?: number
  readonly maxLength?: number
  readonly pattern?: string
  readonly minItems?: number
  readonly maxItems?: number
  readonly uniqueItems?: boolean
  readonly $ref?: string
  readonly $defs?: Readonly<Record<string, JsonSchema>>
  readonly definitions?: Readonly<Record<string, JsonSchema>>
}

/** Either a validating Effect Schema or a render-only JSON Schema document. */
export type SchemaType = Schema.Decoder<unknown> | JsonSchema

/** Context passed to a tool call: its stable idempotency key (`<runId>:<callId>`). */
export type ToolContext = {
  readonly key: string
}

export type ExecuteFn<Input = unknown, Output = unknown, R = never> = (
  input: Input,
  context: ToolContext,
) => Effect.Effect<Output, unknown, R>

/**
 * A tool execution wrapper for idempotent work that is safe to run again. If a suspend lands while the call is running,
 * the VM interrupts it without firing `tool.after`, keeps the call queued in the snapshot, and re-runs it on resume
 * with the same `key` without double-counting against `maxToolCalls`.
 */
export type Idempotent<Input = unknown, Output = unknown, R = never> = {
  readonly _tag: "CodeModeIdempotent"
  readonly execute: ExecuteFn<Input, Output, R>
}

/**
 * Options for `Tool.durable`: `start` begins the work under `key` and returns JSON `data` saved in the snapshot;
 * `wait` connects to the running work and waits for its output; `cancel` stops the work when the run is interrupted
 * for real or ends, never when it is suspended. `wait` is not tied to the program's JS `await`: the VM calls `wait`
 * right after `start` returns, and again for every `started` call right at resume, whatever the program does with the
 * promise.
 */
export type DurableOptions<
  Data extends Schema.Json,
  Input = unknown,
  Output = unknown,
  RStart = never,
  RWait = never,
  RCancel = never,
> = {
  readonly start: (input: Input, context: ToolContext) => Effect.Effect<Data, unknown, RStart>
  readonly wait: (data: NoInfer<Data>, context: ToolContext) => Effect.Effect<Output, unknown, RWait>
  readonly cancel: (data: NoInfer<Data>) => Effect.Effect<void, unknown, RCancel>
}

/** A tool execution wrapper for work that keeps running across a suspend and reconnects through its JSON data. */
export type Durable<Input = unknown, Output = unknown, R = never> = {
  readonly _tag: "CodeModeDurable"
  readonly start: (input: Input, context: ToolContext) => Effect.Effect<Schema.Json, unknown, R>
  readonly wait: (data: never, context: ToolContext) => Effect.Effect<Output, unknown, R>
  readonly cancel: (data: never) => Effect.Effect<void, unknown, R>
}

// Carries Input, Output, and R as a call signature on Tool.make options so TypeScript infers them from the schemas.
type IdempotentOption<Input = unknown, Output = unknown, R = never> = {
  (input: Input, context: ToolContext): Effect.Effect<Output, unknown, R>
  readonly _tag: "CodeModeIdempotent"
  readonly execute: ExecuteFn<Input, Output, R>
}

type DurableOption<Input = unknown, Output = unknown, R = never> = {
  (input: Input, context: ToolContext): Effect.Effect<Output, unknown, R>
  readonly _tag: "CodeModeDurable"
  readonly start: (input: Input, context: ToolContext) => Effect.Effect<Schema.Json, unknown, R>
  readonly wait: (data: never, context: ToolContext) => Effect.Effect<Output, unknown, R>
  readonly cancel: (data: never) => Effect.Effect<void, unknown, R>
}

/** Executable tool exposed through CodeMode's `tools` object. */
export type Tool<R = never> = {
  readonly _tag: "CodeModeTool"
  readonly description: string
  readonly input: SchemaType
  readonly freeform?: boolean
  readonly output: SchemaType | undefined
  readonly execute: ExecuteFn<unknown, unknown, R> | Idempotent<unknown, unknown, R> | Durable<unknown, unknown, R>
}

type InputType<S> = S extends Schema.Decoder<unknown> ? S["Type"] : unknown

type ResultType<S> = S extends undefined ? void : S extends Schema.Decoder<unknown> ? S["Encoded"] : unknown

/** Options for declaring one CodeMode tool. */
export type Options<I extends SchemaType, O extends SchemaType | undefined, R = never> = {
  readonly description: string
  readonly input: I
  /**
   * The tool's input is one required string field that programs pass directly, as in `tools.patch("...")`.
   * The object form still works, and the executor receives the object either way.
   */
  readonly freeform?: boolean
  readonly output?: O
  readonly execute:
    | ExecuteFn<InputType<I>, ResultType<O>, R>
    | IdempotentOption<InputType<I>, ResultType<O>, R>
    | DurableOption<InputType<I>, ResultType<O>, R>
}

export const isTool = <R = never>(value: Tool<R> | Namespace<R> | Tools<R> | undefined): value is Tool<R> =>
  value !== undefined && Object.hasOwn(value, "_tag") && value._tag === "CodeModeTool"

/** Marks a tool's `execute` function as safe to interrupt on suspend and re-run on resume with the same key. */
export const idempotent = <Input, Output, R = never>(
  execute: ExecuteFn<Input, Output, R>,
): IdempotentOption<Input, Output, R> =>
  ({
    _tag: "CodeModeIdempotent",
    execute,
  }) as IdempotentOption<Input, Output, R>

/**
 * Wraps a tool's execution as `start`, `wait`, and `cancel` so work started before a suspend keeps running and
 * reconnects through its JSON data on resume.
 */
export const durable = <
  Data extends Schema.Json,
  Input = unknown,
  Output = unknown,
  RStart = never,
  RWait = never,
  RCancel = never,
>(
  options: DurableOptions<Data, Input, Output, RStart, RWait, RCancel>,
): DurableOption<Input, Output, RStart | RWait | RCancel> =>
  ({
    _tag: "CodeModeDurable",
    start: options.start,
    wait: options.wait,
    cancel: options.cancel,
  }) as unknown as DurableOption<Input, Output, RStart | RWait | RCancel>

/**
 * Declares one schema-described tool available to a CodeMode program through `tools.*`.
 *
 * Effect Schemas validate values; JSON Schemas only shape the model-visible signature.
 * Without `output`, results are exposed as `void`. Hosts remain responsible for authorization
 * and durable side effects.
 */
export const make = <I extends SchemaType, const O extends SchemaType | undefined = undefined, R = never>(
  options: Options<I, O, R>,
): Tool<R> => ({
  _tag: "CodeModeTool",
  description: options.description,
  input: options.input,
  ...(options.freeform && { freeform: true }),
  output: options.output,
  execute: options.execute as Tool<R>["execute"],
})
