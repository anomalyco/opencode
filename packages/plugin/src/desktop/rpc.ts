import { Effect, JsonSchema, Schema, SchemaRepresentation } from "effect"
import type { Rpc } from "@opencode/schema/rpc"
import type { StandardSchemaV1 } from "@standard-schema/spec"
import type { DesktopExtension } from "./protocol.js"

type Input<S extends Rpc.Method["input"]> = S extends Schema.Top ? S["Type"] : Rpc.Input<S>
export type RpcClient<D extends Rpc.Definition> = {
  readonly [Name in keyof D["methods"]]: (
    input: Input<D["methods"][Name]["input"]>,
    options?: { signal?: AbortSignal },
  ) => Promise<Rpc.Output<D["methods"][Name]["output"]>>
} & {
  readonly events: {
    on<Name extends keyof D["events"] & string>(
      name: Name,
      listener: (data: Rpc.EventData<D["events"][Name]["schema"]>) => void,
    ): () => void
  }
}

export class CallError extends Error {
  constructor(
    readonly type: string,
    message: string,
    readonly data?: unknown,
  ) {
    super(message)
  }
}

const codecs = new WeakMap<object, Schema.Codec<unknown>>()
export async function decode(schema: Rpc.Method["input"], input: unknown): Promise<unknown> {
  if (Schema.isSchema(schema)) return Effect.runPromise(Schema.decodeUnknownEffect(schema)(input))
  if ("~standard" in schema) {
    const result = await (schema as StandardSchemaV1)["~standard"].validate(input)
    if (result.issues) throw new Error(result.issues.map((issue) => issue.message).join("; "))
    return result.value
  }
  const codec =
    codecs.get(schema) ??
    Schema.make<Schema.Codec<unknown>>(
      SchemaRepresentation.fromJsonSchemaDocument(JsonSchema.fromSchemaDraft2020_12(schema)).ast,
    )
  codecs.set(schema, codec)
  return Effect.runPromise(Schema.decodeUnknownEffect(codec)(input))
}

export async function encode(schema: Rpc.Method["output"], value: unknown) {
  const encoded = Schema.isSchema(schema)
    ? await Effect.runPromise(Schema.encodeUnknownEffect(schema)(value))
    : await decode(schema, value)
  return Schema.decodeUnknownSync(Schema.Json)(encoded)
}

const Outcome = Schema.Union([
  Schema.Struct({ ok: Schema.Literal(true), output: Schema.Json }),
  Schema.Struct({
    ok: Schema.Literal(false),
    error: Schema.Struct({ type: Schema.String, message: Schema.String, data: Schema.optionalKey(Schema.Json) }),
  }),
])

export function client<D extends Rpc.Definition>(
  extensionID: string,
  definition: D,
  transport: DesktopExtension.Transport,
  signal: AbortSignal,
  own: (dispose: () => void) => unknown,
): RpcClient<D> {
  const methods = Object.fromEntries(
    Object.entries(definition.methods).map(([name, method]) => [
      name,
      async (input: unknown, options?: { signal?: AbortSignal }) => {
        const result = Schema.decodeUnknownSync(Outcome)(
          await transport.call(
            {
              extensionID,
              rpcID: definition.id,
              method: name,
              requestID: crypto.randomUUID(),
              input: await encode(method.input, input),
            },
            options?.signal ? AbortSignal.any([signal, options.signal]) : signal,
          ),
        )
        if (!result.ok) throw new CallError(result.error.type, result.error.message, result.error.data)
        return Schema.isSchema(method.output) ? decode(method.output, result.output) : result.output
      },
    ]),
  )
  // The definition supplies every method name and the codecs preserve its input/output correlation.
  return Object.assign(methods, {
    events: {
      on(name: keyof D["events"] & string, listener: (data: unknown) => void) {
        const event = definition.events[name]
        if (!event) throw new Error(`Unknown extension event: ${name}`)
        let live = true
        const stop = transport.onEvent((message) => {
          if (
            !live ||
            signal.aborted ||
            message.extensionID !== extensionID ||
            message.rpcID !== definition.id ||
            message.name !== name
          )
            return
          void decode(event.schema, message.data)
            .then((data) => {
              if (live && !signal.aborted) listener(data)
            })
            .catch(console.error)
        })
        const dispose = () => {
          live = false
          stop()
        }
        own(dispose)
        return dispose
      },
    },
  }) as RpcClient<D>
}
