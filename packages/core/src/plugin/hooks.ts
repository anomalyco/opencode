export * as PluginHooks from "./hooks.js"

import type { AISDKHooks } from "@opencode-ai/plugin/effect/aisdk"
import type { SessionHooks } from "@opencode-ai/plugin/effect/session"
import type { ShellHooks } from "@opencode-ai/plugin/effect/shell"
import type { ToolFailures, ToolHooks } from "@opencode-ai/plugin/effect/tool"
import type { ModelHookOptions } from "@opencode-ai/plugin/effect/registration"
import type { PermissionHooks } from "@opencode-ai/plugin/effect/permission"
import { Context, Effect, Layer, Scope } from "effect"
import { makeLocationNode } from "@opencode-ai/util/effect/app-node"
import { State } from "../state.js"

export interface Domains {
  readonly aisdk: AISDKHooks
  readonly session: SessionHooks
  readonly permission: PermissionHooks
  readonly shell: ShellHooks
  readonly tool: ToolHooks
}

type NoFailures<Spec> = { readonly [Name in keyof Spec]: never }

// Failure channel for each hook event. Only tool execute.before may fail: a Tool.Error rejects the call before it runs.
interface Failures extends Record<keyof Domains, unknown> {
  readonly aisdk: NoFailures<AISDKHooks>
  readonly session: NoFailures<SessionHooks>
  readonly permission: NoFailures<PermissionHooks>
  readonly shell: NoFailures<ShellHooks>
  readonly tool: ToolFailures
}

type Callback<Event, Error> = (event: Event) => Effect.Effect<void, Error>
type Entry = { readonly callback: Function; readonly options?: ModelHookOptions }

const eventProviderID = (event: unknown) => {
  if (typeof event !== "object" || event === null || !("model" in event)) return undefined
  const model = event.model
  if (typeof model !== "object" || model === null || !("providerID" in model)) return undefined
  return typeof model.providerID === "string" ? model.providerID : undefined
}

export interface Interface {
  readonly has: <Domain extends keyof Domains>(
    domain: Domain,
    name: keyof Domains[Domain] & keyof Failures[Domain],
    providerID?: string,
  ) => Effect.Effect<boolean>
  readonly register: <Domain extends keyof Domains, Name extends keyof Domains[Domain] & keyof Failures[Domain]>(
    domain: Domain,
    name: Name,
    callback: Callback<Domains[Domain][Name], Failures[Domain][Name]>,
    options?: ModelHookOptions,
  ) => Effect.Effect<State.Registration, never, Scope.Scope>
  readonly trigger: <Domain extends keyof Domains, Name extends keyof Domains[Domain] & keyof Failures[Domain]>(
    domain: Domain,
    name: Name,
    event: Domains[Domain][Name],
  ) => Effect.Effect<Domains[Domain][Name], Failures[Domain][Name]>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/PluginHooks") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const callbacks = new Map<string, Entry[]>()
    const key = (domain: keyof Domains, name: PropertyKey) => `${domain}.${String(name)}`

    const register: Interface["register"] = Effect.fn("PluginHooks.register")(
      function* (domain, name, callback, options) {
        const scope = yield* Scope.Scope
        const id = key(domain, name)
        let active = true
        const entry = { callback, options }
        callbacks.set(id, [...(callbacks.get(id) ?? []), entry])
        const dispose = Effect.sync(() => {
          if (!active) return
          active = false
          const next = (callbacks.get(id) ?? []).filter((item) => item !== entry)
          if (next.length === 0) callbacks.delete(id)
          else callbacks.set(id, next)
        })
        yield* Scope.addFinalizer(scope, dispose)
        return { dispose }
      },
    )

    const trigger: Interface["trigger"] = Effect.fnUntraced(function* (domain, name, event) {
      for (const entry of callbacks.get(key(domain, name)) ?? []) {
        if (entry.options?.providerID !== undefined && entry.options.providerID !== eventProviderID(event)) continue
        const result: Effect.Effect<void, Failures[typeof domain][typeof name]> = Reflect.apply(
          entry.callback,
          undefined,
          [event],
        )
        yield* result
      }
      return event
    })

    const has: Interface["has"] = (domain, name, providerID) =>
      Effect.sync(() =>
        (callbacks.get(key(domain, name)) ?? []).some(
          (entry) => entry.options?.providerID === undefined || entry.options.providerID === providerID,
        ),
      )

    return Service.of({ has, register, trigger })
  }),
)

export const node = makeLocationNode({ service: Service, layer, deps: [] })
