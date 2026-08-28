export * as PluginInvoke from "./invoke"

import { makeGlobalNode } from "../effect/app-node"
import { Context, Effect, Layer, Schema, Scope } from "effect"

export class UnknownPluginError extends Schema.TaggedErrorClass<UnknownPluginError>()(
  "PluginInvoke.UnknownPluginError",
  {
    pluginID: Schema.String,
  },
) {}

export class UnknownInvokeError extends Schema.TaggedErrorClass<UnknownInvokeError>()(
  "PluginInvoke.UnknownInvokeError",
  {
    pluginID: Schema.String,
    name: Schema.String,
  },
) {}

export type InvokeError = UnknownPluginError | UnknownInvokeError

export type Handler = (input: unknown) => Effect.Effect<unknown>

export interface Registration {
  readonly dispose: Effect.Effect<void>
}

export interface Entry {
  readonly id: string
  readonly invokes: string[]
}

export interface Interface {
  readonly register: (
    pluginID: string,
    name: string,
    handler: Handler,
  ) => Effect.Effect<Registration, never, Scope.Scope>
  readonly invoke: (pluginID: string, name: string, input: unknown) => Effect.Effect<unknown, InvokeError>
  readonly list: () => Entry[]
}

export class Service extends Context.Service<Service, Interface>()("@opencode/v2/PluginInvoke") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    // ponytail: process-global registry shared by all locations, so duplicate
    // names register once (first registration wins) and a plugin removed in one
    // location removes its invokes for all. Per-location registries if isolation matters.
    const entries = new Map<string, Map<string, Handler>>()

    const remove = (pluginID: string, name: string) => {
      const names = entries.get(pluginID)
      if (!names) return
      names.delete(name)
      if (names.size === 0) entries.delete(pluginID)
    }

    const register = Effect.fn("PluginInvoke.register")(function* (pluginID: string, name: string, handler: Handler) {
      if (entries.get(pluginID)?.has(name)) return { dispose: Effect.void }
      const current = entries.get(pluginID) ?? new Map<string, Handler>()
      current.set(name, handler)
      entries.set(pluginID, current)
      const scope = yield* Scope.Scope
      const dispose = Effect.sync(() => remove(pluginID, name))
      yield* Scope.addFinalizer(scope, dispose)
      return { dispose }
    })

    const invoke = Effect.fn("PluginInvoke.invoke")(function* (pluginID: string, name: string, input: unknown) {
      const names = entries.get(pluginID)
      if (!names) return yield* new UnknownPluginError({ pluginID })
      const handler = names.get(name)
      if (!handler) return yield* new UnknownInvokeError({ pluginID, name })
      return yield* handler(input)
    })

    const list = () => Array.from(entries.entries()).map(([id, names]) => ({ id, invokes: Array.from(names.keys()) }))

    return Service.of({ register, invoke, list })
  }),
)

export const node = makeGlobalNode({ service: Service, layer, deps: [] })
