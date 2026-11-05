import { Effect, Schema } from "effect"
import type { Namespace } from "./namespace.js"
import type { Tools } from "./tools.js"
import { SuspendError } from "./suspend-error.js"

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

/** A JSON handle a durable tool gives for work that outlives the fiber waiting on it. */
export type Handle = Schema.Json

/**
 * What a durable call's `start` and `attach` get: its idempotency key, and `suspend`, which suspends the run with this
 * call pending, for the host to finish and give its outcome to `resume`. It never succeeds: the call's fiber is
 * detached and interrupted. It fails with a `SuspendError`, leaving the run running, while another host call blocks a
 * suspend (see `Runtime.execute`), or outside a run.
 */
export type DurableContext = {
  readonly key: string
  readonly suspend: Effect.Effect<never, SuspendError>
}

/**
 * How a durable tool runs work that can outlive a suspended run: `start` launches it under the idempotency `key` and
 * returns a handle quickly; `attach` waits for its result (interrupting it detaches, never cancels); `cancel` stops
 * the work. A run can be suspended while a durable call's work runs, once `start` returned its handle; the host then
 * waits on the work itself and gives its outcome to `resume`. `lookup`, which finds the handle of work started under
 * `key`, is for the host: the runtime doesn't call it.
 */
export type Durable<Input = unknown, Output = unknown, R = never> = {
  readonly start: (input: Input, context: DurableContext) => Effect.Effect<Handle, unknown, R>
  readonly attach: (handle: Handle, context: DurableContext) => Effect.Effect<Output, unknown, R>
  readonly lookup?: ((key: string) => Effect.Effect<Handle | undefined, unknown, R>) | undefined
  readonly cancel: (handle: Handle) => Effect.Effect<void, unknown, R>
}

/** Executable tool exposed through CodeMode's `tools` object. */
export type Tool<R = never> = {
  readonly _tag: "CodeModeTool"
  readonly description: string
  readonly input: SchemaType
  readonly output: SchemaType | undefined
  /**
   * Runs a call. A run passes the call's idempotency key, `<run id>:<call id>`, stable across a suspended run's
   * resumes; called directly, a random key stands in.
   */
  readonly execute: (input: unknown, context?: { readonly key: string }) => Effect.Effect<unknown, unknown, R>
  readonly durable?: Durable<unknown, unknown, R> | undefined
}

type InputType<S> = S extends Schema.Decoder<unknown> ? S["Type"] : unknown

type ResultType<S> = S extends undefined ? void : S extends Schema.Decoder<unknown> ? S["Encoded"] : unknown

/** Options for declaring one CodeMode tool: `execute`, `durable`, or both (`execute` then runs outside a run). */
export type Options<I extends SchemaType, O extends SchemaType | undefined, R = never> = {
  readonly description: string
  readonly input: I
  readonly output?: O
} & (
  | {
      readonly execute: (
        input: InputType<I>,
        context: { readonly key: string },
      ) => Effect.Effect<ResultType<O>, unknown, R>
      readonly durable?: Durable<InputType<I>, ResultType<O>, R>
    }
  | { readonly execute?: undefined; readonly durable: Durable<InputType<I>, ResultType<O>, R> }
)

const outsideRun = Effect.fail(
  new SuspendError({ message: "This call isn't part of a run, so it can't suspend one.", running: [] }),
)

export const isTool = <R = never>(value: Tool<R> | Namespace<R> | Tools<R> | undefined): value is Tool<R> =>
  value !== undefined && Object.hasOwn(value, "_tag") && value._tag === "CodeModeTool"

/**
 * Declares one schema-described tool available to a CodeMode program through `tools.*`.
 *
 * Effect Schemas validate values; JSON Schemas only shape the model-visible signature.
 * Without `output`, results are exposed as `void`. Hosts remain responsible for authorization
 * and durable side effects; a `durable` tool keeps its work running across a suspended run (see `Durable`).
 */
export const make = <I extends SchemaType, const O extends SchemaType | undefined = undefined, R = never>(
  options: Options<I, O, R>,
): Tool<R> => {
  const durable = options.durable as Durable<unknown, unknown, R> | undefined
  const execute = options.execute as
    | ((input: unknown, context: { readonly key: string }) => Effect.Effect<unknown, unknown, R>)
    | undefined
  if (execute === undefined && durable === undefined) throw new TypeError("A tool needs `execute` or `durable`.")
  return {
    _tag: "CodeModeTool",
    description: options.description,
    input: options.input,
    output: options.output,
    execute: (input, context = { key: crypto.randomUUID() }) => {
      if (execute !== undefined) return execute(input, context)
      const durableContext = { key: context.key, suspend: outsideRun }
      return Effect.flatMap(durable!.start(input, durableContext), (handle) => durable!.attach(handle, durableContext))
    },
    ...(durable === undefined ? {} : { durable }),
  }
}
