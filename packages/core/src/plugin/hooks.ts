export * as PluginHooks from "./hooks.js"

import type { AISDKHooks } from "@opencode/plugin/effect/aisdk"
import type { ModelHttpRequest, ModelHttpResponse, ModelRequestHooks } from "@opencode/plugin/effect/model"
import type { SessionHooks, SessionHttpRequest, SessionHttpResponse } from "@opencode/plugin/effect/session"
import type { ShellHooks } from "@opencode/plugin/effect/shell"
import type { ToolFailures, ToolHooks } from "@opencode/plugin/effect/tool"
import type { ModelHookOptions } from "@opencode/plugin/effect/registration"
import type { PermissionHooks } from "@opencode/plugin/effect/permission"
import { Context, Effect, Layer, Scope } from "effect"
import { makeLocationNode } from "@opencode/util/effect/app-node"
import { State } from "../state.js"

export interface Domains {
  readonly aisdk: AISDKHooks
  readonly model: ModelRequestHooks
  readonly session: SessionHooks
  readonly permission: PermissionHooks
  readonly shell: ShellHooks
  readonly tool: ToolHooks
}

type NoFailures<Spec> = { readonly [Name in keyof Spec]: never }

// Failure channel for each hook event. Only tool execute.before may fail: a Tool.Error rejects the call before it runs.
interface Failures extends Record<keyof Domains, unknown> {
  readonly aisdk: NoFailures<AISDKHooks>
  readonly model: NoFailures<ModelRequestHooks>
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

type Name<Domain extends keyof Domains> = keyof Domains[Domain] & keyof Failures[Domain]
// The deprecated session HTTP hooks register into the model HTTP hooks, so only the model names are triggered.
type Triggered<Domain extends keyof Domains> = Exclude<
  Name<Domain>,
  Domain extends "session" ? "http.request" | "http.response" : never
>

export interface Interface {
  readonly has: <Domain extends keyof Domains>(
    domain: Domain,
    name: Triggered<Domain>,
    providerID?: string,
  ) => Effect.Effect<boolean>
  readonly register: <Domain extends keyof Domains, Name extends keyof Domains[Domain] & keyof Failures[Domain]>(
    domain: Domain,
    name: Name,
    callback: Callback<Domains[Domain][Name], Failures[Domain][Name]>,
    options?: ModelHookOptions,
  ) => Effect.Effect<State.Registration, never, Scope.Scope>
  readonly trigger: <Domain extends keyof Domains, Hook extends Triggered<Domain>>(
    domain: Domain,
    name: Hook,
    event: Domains[Domain][Hook],
  ) => Effect.Effect<Domains[Domain][Hook], Failures[Domain][Hook]>
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
        // The session HTTP hooks are model HTTP hooks that skip calls made outside a Session.
        const legacy =
          domain === "session" && name === "http.request"
            ? sessionHttp.request
            : domain === "session" && name === "http.response"
              ? sessionHttp.response
              : undefined
        const id = legacy ? legacy.id : key(domain, name)
        let active = true
        const entry = { callback: legacy ? legacy.adapt(callback) : callback, options }
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
        const result: Effect.Effect<void, Failures[typeof domain][typeof name]> = entry.callback(event)
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

const sessionHttp = {
  request: { id: "model.experimental.http.request", adapt: sessionRequest },
  response: { id: "model.experimental.http.response", adapt: sessionResponse },
}

function sessionRequest(callback: Function) {
  return (event: ModelHttpRequest): Effect.Effect<void> => {
    if (event.session === undefined) return Effect.void
    const legacy: SessionHttpRequest = {
      sessionID: event.session.id,
      agent: event.session.agent,
      model: event.model,
      kind: event.kind,
      request: event.request,
    }
    return Effect.map(callback(legacy), () => {
      event.request = legacy.request
    })
  }
}

function sessionResponse(callback: Function) {
  return (event: ModelHttpResponse): Effect.Effect<void> => {
    if (event.session === undefined) return Effect.void
    const legacy: SessionHttpResponse = {
      sessionID: event.session.id,
      agent: event.session.agent,
      model: event.model,
      kind: event.kind,
      request: event.request,
      response: event.response,
    }
    return Effect.map(callback(legacy), () => {
      event.response = legacy.response
    })
  }
}

export const node = makeLocationNode({ service: Service, layer, deps: [] })
