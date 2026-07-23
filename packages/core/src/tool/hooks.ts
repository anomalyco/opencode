export * as ToolHooks from "./hooks"

import { makeLocationNode } from "@opencode-ai/util/effect/app-node"
import { State } from "../state"
import { Context, Effect, Layer, Scope } from "effect"
import type { Tool } from "./tool"

export type BeforeEvent = Tool.ToolExecuteBeforeEvent

/** The canonical execution outcome. Hooks never observe the raw domain output. */
export type AfterEvent = Tool.ToolExecuteAfterEvent

export interface Interface {
  readonly hook: {
    readonly before: (
      callback: (event: BeforeEvent) => Effect.Effect<void> | void,
    ) => Effect.Effect<State.Registration, never, Scope.Scope>
    readonly after: (
      callback: (event: AfterEvent) => Effect.Effect<void> | void,
    ) => Effect.Effect<State.Registration, never, Scope.Scope>
  }
  readonly runBefore: (event: BeforeEvent) => Effect.Effect<BeforeEvent>
  readonly runAfter: (event: AfterEvent) => Effect.Effect<AfterEvent>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/v2/ToolHooks") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    let beforeHooks: ((event: BeforeEvent) => Effect.Effect<void> | void)[] = []
    let afterHooks: ((event: AfterEvent) => Effect.Effect<void> | void)[] = []

    const register = <Event>(
      hooks: () => ((event: Event) => Effect.Effect<void> | void)[],
      update: (hooks: ((event: Event) => Effect.Effect<void> | void)[]) => void,
    ) =>
      Effect.fn("ToolHooks.hook")(function* (callback: (event: Event) => Effect.Effect<void> | void) {
        const scope = yield* Scope.Scope
        let active = true
        update([...hooks(), callback])
        const dispose = Effect.sync(() => {
          if (!active) return
          active = false
          update(hooks().filter((item) => item !== callback))
        })
        yield* Scope.addFinalizer(scope, dispose)
        return { dispose }
      })

    const run = Effect.fnUntraced(function* <Event>(
      hooks: readonly ((event: Event) => Effect.Effect<void> | void)[],
      event: Event,
    ) {
      for (const hook of hooks) {
        const result = hook(event)
        if (Effect.isEffect(result)) yield* result
      }
      return event
    })

    return Service.of({
      hook: {
        before: register(
          () => beforeHooks,
          (next) => (beforeHooks = next),
        ),
        after: register(
          () => afterHooks,
          (next) => (afterHooks = next),
        ),
      },
      runBefore: (event) => run(beforeHooks, event),
      runAfter: (event) => run(afterHooks, event),
    })
  }),
)

export const node = makeLocationNode({ service: Service, layer, deps: [] })
