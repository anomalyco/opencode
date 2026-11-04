export * as SessionGate from "./gate.js"

import { Context, Effect, Layer, Scope } from "effect"
import { makeLocationNode } from "@opencode/util/effect/app-node"
import type { State } from "../state.js"
import type { StepFailedError } from "./error.js"

type Gate = Effect.Effect<void, StepFailedError>

/**
 * Conditions every model request waits on before its context is selected, so its instructions, tools and policies
 * are read only once they hold. Internal plugins register them; a failure fails the execution before the request is
 * built.
 */
export interface Interface {
  readonly register: (gate: Gate) => Effect.Effect<State.Registration, never, Scope.Scope>
  /** Runs every registered gate in registration order. */
  readonly wait: Gate
}

export class Service extends Context.Service<Service, Interface>()("@opencode/SessionGate") {}

const layer = Layer.sync(Service, () => {
  const gates = new Set<{ readonly gate: Gate }>()
  return Service.of({
    register: Effect.fn("SessionGate.register")(function* (gate) {
      const entry = { gate }
      gates.add(entry)
      const dispose = Effect.sync(() => {
        gates.delete(entry)
      })
      yield* Effect.addFinalizer(() => dispose)
      return { dispose }
    }),
    wait: Effect.suspend(() => Effect.forEach(gates, (entry) => entry.gate, { discard: true })),
  })
})

export const node = makeLocationNode({ service: Service, layer, deps: [] })
