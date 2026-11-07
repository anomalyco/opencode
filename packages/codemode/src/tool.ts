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

/** A JSON handle a reconnectable tool's `start` returns, saved in a suspended run's state. */
export type Handle = Schema.Json

/** Context passed to a tool call: its stable idempotency key (`<runId>:<callId>`). */
export type ToolContext = {
  readonly key: string
}

/**
 * How a reconnectable tool runs work that outlives a suspended run: `start` begins the work under `key` and returns a
 * JSON handle; `attach` connects to the running work and waits for its result; `cancel` stops the work when the run is
 * interrupted, not when it is suspended. `attach` is not tied to the program's JS `await`: the VM calls `attach` right
 * after `start` returns, and again for every `started` call right at resume, whatever the program does with the
 * promise.
 */
export type Reconnectable<Input = unknown, Output = unknown, R = never> = {
  readonly start: (input: Input, context: ToolContext) => Effect.Effect<Handle, unknown, R>
  readonly attach: (handle: Handle, context: ToolContext) => Effect.Effect<Output, unknown, R>
  readonly cancel: (handle: Handle) => Effect.Effect<void, unknown, R>
}

/**
 * How a tool behaves when a run is suspended while a call to it is in flight (`engine: "vm"` only; ignored on legacy):
 * - `false` (default): suspend is refused while the call runs.
 * - `"rerun"`: safe to run again; suspending interrupts the running call and re-runs it on resume with the same key.
 * - `{ start, attach, cancel }`: reconnectable work that continues across a suspend once `start` has returned its handle.
 */
export type Durable<Input = unknown, Output = unknown, R = never> = false | "rerun" | Reconnectable<Input, Output, R>

/** Executable tool exposed through CodeMode's `tools` object. */
export type Tool<R = never> = {
  readonly _tag: "CodeModeTool"
  readonly description: string
  readonly input: SchemaType
  readonly output: SchemaType | undefined
  readonly execute: (input: unknown, context?: ToolContext) => Effect.Effect<unknown, unknown, R>
  readonly durable?: Durable<unknown, unknown, R> | undefined
}

type InputType<S> = S extends Schema.Decoder<unknown> ? S["Type"] : unknown

type ResultType<S> = S extends undefined ? void : S extends Schema.Decoder<unknown> ? S["Encoded"] : unknown

/** Options for declaring one CodeMode tool. */
export type Options<I extends SchemaType, O extends SchemaType | undefined, R = never> = {
  readonly description: string
  readonly input: I
  readonly output?: O
} & (
  | {
      readonly execute: (input: InputType<I>, context: ToolContext) => Effect.Effect<ResultType<O>, unknown, R>
      readonly durable?: Durable<InputType<I>, ResultType<O>, R> | undefined
    }
  | {
      readonly execute?: undefined
      readonly durable: Reconnectable<InputType<I>, ResultType<O>, R>
    }
)

export const isTool = <R = never>(value: Tool<R> | Namespace<R> | Tools<R> | undefined): value is Tool<R> =>
  value !== undefined && Object.hasOwn(value, "_tag") && value._tag === "CodeModeTool"

/**
 * Declares one schema-described tool available to a CodeMode program through `tools.*`.
 *
 * Effect Schemas validate values; JSON Schemas only shape the model-visible signature.
 * Without `output`, results are exposed as `void`. Hosts remain responsible for authorization
 * and durable side effects.
 */
export const make = <I extends SchemaType, const O extends SchemaType | undefined = undefined, R = never>(
  options: Options<I, O, R>,
): Tool<R> => {
  const durable = (options.durable as Durable<unknown, unknown, R> | undefined) ?? false
  const execute = options.execute as
    | ((input: unknown, context: ToolContext) => Effect.Effect<unknown, unknown, R>)
    | undefined
  if (execute === undefined && typeof durable !== "object") {
    throw new TypeError("A tool needs `execute` or reconnectable `durable` hooks.")
  }
  return {
    _tag: "CodeModeTool",
    description: options.description,
    input: options.input,
    output: options.output,
    durable,
    execute: (input, context = { key: crypto.randomUUID() }) => {
      if (execute !== undefined) return execute(input, context)
      const reconnectable = durable as Reconnectable<unknown, unknown, R>
      return Effect.flatMap(reconnectable.start(input, context), (handle) => reconnectable.attach(handle, context))
    },
  }
}
