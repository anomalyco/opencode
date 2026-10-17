export * as RestartIntent from "./restart-intent"

import { ServiceEvent } from "@opencode/schema/service-event"
import { Context, Effect, Layer, Ref } from "effect"

export type Settlement = { readonly winner: ServiceEvent.Decision; readonly fresh: boolean } | undefined

type IntentState = {
  readonly generation: number
  readonly pending: boolean
  readonly last?: ServiceEvent.Decision
}

export class Service extends Context.Service<Service, {
  /**
   * Record a pending intent unless one exists. Returns the generation token for
   * this request, used to expire it without disturbing a later one.
   */
  readonly request: () => Effect.Effect<number>
  /**
   * Resolve the pending intent with first-wins semantics. Returns the winning
   * decision and whether this call settled it; late resolvers replay the
   * winner without rebroadcasting. Returns undefined when no intent exists.
   */
  readonly resolve: (decision: ServiceEvent.Decision) => Effect.Effect<Settlement>
  /**
   * Drop the pending intent when it is still the given generation. Returns
   * whether this call expired it; a stale token or a settled intent is a no-op.
   */
  readonly expire: (generation: number) => Effect.Effect<boolean>
}>()("@opencode/server/RestartIntent") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const state = yield* Ref.make<IntentState>({ generation: 0, pending: false })
    return Service.of({
      request: () =>
        Ref.modify(
          state,
          (current): readonly [number, IntentState] => {
            const generation = current.generation + 1
            return [generation, current.pending ? { ...current, generation } : { generation, pending: true }]
          },
        ),
      resolve: (decision) =>
        Ref.modify(state, (current): readonly [Settlement, IntentState] => {
          if (!current.pending) {
            return current.last === undefined
              ? [undefined, current]
              : [{ winner: current.last, fresh: false }, current]
          }
          return [{ winner: decision, fresh: true }, { ...current, pending: false, last: decision }]
        }),
      expire: (generation) =>
        Ref.modify(state, (current): readonly [boolean, IntentState] => {
          if (!current.pending || current.generation !== generation) return [false, current]
          return [true, { ...current, pending: false }]
        }),
    })
  }),
)
