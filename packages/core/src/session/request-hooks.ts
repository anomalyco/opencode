export * as SessionRequestHooks from "./request-hooks"

import type { Message, SystemPart } from "@opencode-ai/llm"
import { Agent } from "@opencode-ai/schema/agent"
import { Model } from "@opencode-ai/schema/model"
import { Session } from "@opencode-ai/schema/session"
import { Context, Effect, Layer, Scope } from "effect"
import { makeLocationNode } from "../effect/app-node"
import { State } from "../state"

export interface Tool {
  description: string
  input: Record<string, unknown>
}

export interface BeforeEvent {
  readonly sessionID: Session.ID
  readonly agent: Agent.ID
  readonly model: Model.Ref
  system: Array<SystemPart>
  messages: Array<Message>
  tools: Record<string, Tool>
}

export interface Interface {
  readonly before: (
    callback: (event: BeforeEvent) => Effect.Effect<void> | void,
  ) => Effect.Effect<State.Registration, never, Scope.Scope>
  readonly runBefore: (event: BeforeEvent) => Effect.Effect<BeforeEvent>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/v2/SessionRequestHooks") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    let hooks: ((event: BeforeEvent) => Effect.Effect<void> | void)[] = []

    const before = Effect.fn("SessionRequestHooks.before")(function* (
      callback: (event: BeforeEvent) => Effect.Effect<void> | void,
    ) {
      const scope = yield* Scope.Scope
      let active = true
      hooks = [...hooks, callback]
      const dispose = Effect.sync(() => {
        if (!active) return
        active = false
        hooks = hooks.filter((item) => item !== callback)
      })
      yield* Scope.addFinalizer(scope, dispose)
      return { dispose }
    })

    const runBefore = Effect.fn("SessionRequestHooks.runBefore")(function* (event: BeforeEvent) {
      for (const hook of hooks) {
        const result = hook(event)
        if (Effect.isEffect(result)) yield* result
      }
      return event
    })

    return Service.of({ before, runBefore })
  }),
)

export const node = makeLocationNode({ service: Service, layer, deps: [] })
