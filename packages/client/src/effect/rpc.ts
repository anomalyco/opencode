export * as RpcClientRuntime from "./rpc.js"

import type { Rpc } from "@opencode-ai/schema/rpc"
import type { RpcError, RpcInternalError } from "@opencode-ai/protocol/errors"
import type { OpenCodeEvent } from "@opencode-ai/protocol/groups/event"
import { Effect, Schema, Stream } from "effect"
import type { RpcArguments, RpcCallOptions } from "../promise/rpc.js"
import { RpcRuntime } from "../rpc-runtime.js"
import type { RpcCallInput, RpcCallOutput } from "./api/api.js"

type RpcEvent = Extract<OpenCodeEvent, { type: `rpc.${string}` }>
type DecodeError<S> = S extends Schema.Top ? Schema.SchemaError : never

export type RpcClient<
  D extends Rpc.Definition,
  E = never,
  Options = RpcCallOptions,
  EventError = E,
> = {
  readonly [Name in keyof D["methods"]]: (
    ...args: RpcArguments<Rpc.Input<D["methods"][Name]["input"]>, Options>
  ) => Effect.Effect<
    Rpc.Output<D["methods"][Name]["output"]>,
    Rpc.MethodError<D["methods"][Name]> | DecodeError<D["methods"][Name]["output"]> | E
  >
} & {
  readonly events: {
    readonly subscribe: <Name extends keyof D["events"] & string>(
      name: Name,
    ) => Stream.Stream<Rpc.EventPayload<D, Name>, DecodeError<D["events"][Name]["schema"]> | EventError>
  }
}

export interface RpcApi<E = never, Options = RpcCallOptions, EventError = E> {
  <D extends Rpc.Definition>(definition: D): RpcClient<D, E, Options, EventError>
}

export function make<CallError, EventError>(
  call: (input: RpcCallInput, options?: RpcCallOptions) => Effect.Effect<RpcCallOutput, CallError>,
  subscribe: () => Stream.Stream<OpenCodeEvent, EventError>,
): RpcApi<Exclude<CallError, RpcError | RpcInternalError> | Rpc.SystemError, RpcCallOptions, EventError> {
  return <D extends Rpc.Definition>(definition: D) => {
    const methods = Object.fromEntries(
      Object.entries(definition.methods).map(([name, method]) => [
        name,
        (input?: unknown, options?: RpcCallOptions) => {
          const result = Effect.gen(function* () {
            const response = yield* call(
              {
                rpcID: definition.id,
                method: name,
                input,
                location: options?.location,
              },
              options,
            )
            return yield* RpcRuntime.read(method.output, response.output)
          }).pipe(Effect.catch((error) => RpcRuntime.readError(method, error)))
          const signal = options?.signal
          if (!signal) return result
          return Effect.suspend(() =>
            signal.aborted
              ? Effect.interrupt
              : Effect.raceFirst(result, Effect.andThen(aborted(signal), Effect.interrupt)),
          )
        },
      ]),
    )
    // SAFETY: Every runtime key comes from this definition, and each value is decoded through its corresponding schema.
    // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion
    return Object.assign(methods, {
        events: {
          subscribe: (name: keyof D["events"] & string) => {
            const type = RpcRuntime.eventType(definition, name)
            if (!Object.hasOwn(definition.events, name)) return Stream.fail(new Error(`Unknown RPC event: ${type}`))
            const schema = definition.events[name]
            return subscribe().pipe(
              Stream.filter((event): event is RpcEvent => event.type === type),
              Stream.mapEffect((event) => RpcRuntime.event(definition, name, schema, event)),
            )
          },
      },
    }) as RpcClient<D, Exclude<CallError, RpcError | RpcInternalError> | Rpc.SystemError, RpcCallOptions, EventError>
  }
}

export function aborted(signal: AbortSignal) {
  return Effect.callback<void>((resume) => {
    if (signal.aborted) return resume(Effect.void)
    const abort = () => resume(Effect.void)
    signal.addEventListener("abort", abort, { once: true })
    return Effect.sync(() => signal.removeEventListener("abort", abort))
  })
}
