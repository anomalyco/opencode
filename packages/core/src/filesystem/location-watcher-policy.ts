export * as LocationWatcherPolicy from "./location-watcher-policy.js"

import { makeLocationNode } from "@opencode-ai/util/effect/app-node"
import { Context, Effect, Layer, Scope } from "effect"
import { State } from "../state.js"

type Data = {
  ignore: string[]
}

export type Draft = {
  add: (ignore: readonly string[]) => void
  list: () => readonly string[]
}

export interface Interface extends State.Transformable<Draft> {
  readonly current: () => readonly string[]
  readonly observe: (
    listener: (ignore: readonly string[]) => Effect.Effect<void>,
  ) => Effect.Effect<State.Registration, never, Scope.Scope>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/LocationWatcherPolicy") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const listeners = new Set<(ignore: readonly string[]) => Effect.Effect<void>>()
    const state: State.Interface<Data, Draft> = State.create<Data, Draft>({
      name: "location-watcher-policy",
      initial: () => ({ ignore: [] }),
      draft: (draft) => ({
        add: (ignore) => draft.ignore.push(...ignore),
        list: () => draft.ignore,
      }),
      notify: () => Effect.forEach(listeners, (listener) => listener(state.get().ignore), { discard: true }),
    })
    const observe = Effect.fn("LocationWatcherPolicy.observe")(function* (
      listener: (ignore: readonly string[]) => Effect.Effect<void>,
    ) {
      const scope = yield* Scope.Scope
      let active = true
      const dispose = Effect.sync(() => {
        if (!active) return
        active = false
        listeners.delete(listener)
      })
      listeners.add(listener)
      yield* Scope.addFinalizer(scope, dispose)
      return { dispose }
    })
    return Service.of({
      transform: state.transform,
      reload: state.reload,
      current: () => state.get().ignore,
      observe,
    })
  }),
)

export const node = makeLocationNode({ service: Service, layer, deps: [] })
