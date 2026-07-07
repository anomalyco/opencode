export * as PluginHooks from "./hooks"

import type { AISDKHooks } from "@opencode-ai/plugin/v2/effect/aisdk"
import type { SessionHooks } from "@opencode-ai/plugin/v2/effect/session"
import type { ToolHooks } from "@opencode-ai/plugin/v2/effect/tool"
import { Context, Effect, Layer, Scope } from "effect"
import { makeLocationNode } from "../effect/app-node"
import { State } from "../state"

export interface Domains {
  readonly aisdk: AISDKHooks
  readonly session: SessionHooks
  readonly tool: ToolHooks
}

type Callback<Event> = (event: Event) => Effect.Effect<void>

export interface Interface {
  readonly register: <Domain extends keyof Domains, Name extends keyof Domains[Domain]>(
    domain: Domain,
    name: Name,
    callback: Callback<Domains[Domain][Name]>,
  ) => Effect.Effect<State.Registration, never, Scope.Scope>
  readonly trigger: <Domain extends keyof Domains, Name extends keyof Domains[Domain]>(
    domain: Domain,
    name: Name,
    event: Domains[Domain][Name],
  ) => Effect.Effect<Domains[Domain][Name]>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/v2/PluginHooks") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const callbacks = new Map<string, Function[]>()
    const key = (domain: keyof Domains, name: PropertyKey) => `${domain}.${String(name)}`

    const register: Interface["register"] = Effect.fn("PluginHooks.register")(function* (domain, name, callback) {
      const scope = yield* Scope.Scope
      const id = key(domain, name)
      let active = true
      callbacks.set(id, [...(callbacks.get(id) ?? []), callback])
      const dispose = Effect.sync(() => {
        if (!active) return
        active = false
        const next = (callbacks.get(id) ?? []).filter((item) => item !== callback)
        if (next.length === 0) callbacks.delete(id)
        else callbacks.set(id, next)
      })
      yield* Scope.addFinalizer(scope, dispose)
      return { dispose }
    })

    const trigger: Interface["trigger"] = Effect.fn("PluginHooks.trigger")(function* (domain, name, event) {
      for (const callback of callbacks.get(key(domain, name)) ?? []) {
        const result: Effect.Effect<void> = Reflect.apply(callback, undefined, [event])
        yield* result
      }
      return event
    })

    return Service.of({ register, trigger })
  }),
)

export const node = makeLocationNode({ service: Service, layer, deps: [] })
