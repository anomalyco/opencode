export * as PlanModels from "./plan-models.js"

import { Event } from "@opencode/schema/config"
import { Effect, Stream } from "effect"
import { Bus } from "../../bus.js"
import { Config } from "../../config.js"
import { Flag } from "../../flag.js"
import type { Provider } from "../../provider.js"
import { ModelsDev } from "../../models-dev.js"

/**
 * Keeps a copy of the model IDs models.dev lists for one sign-in plan on a provider, and runs `reload` when a catalog
 * refresh changes them. `current` is undefined when the catalog has no list for the plan (a cache or bundled
 * snapshot from before it was added, or a custom mirror), so callers fall back to their own rules.
 */
export const track = Effect.fnUntraced(function* (providerID: Provider.ID, planID: string, reload: Effect.Effect<void>) {
  const modelsDev = yield* ModelsDev.Service
  const bus = yield* Bus.Service
  const config = yield* Config.Service
  const flags = yield* Flag.Service
  // Same catalog view as the models.dev plugin, so both read one cached copy.
  const read = config.entries().pipe(
    Effect.flatMap((entries) => modelsDev.get(flags.resolve(entries).recommended_api.enabled)),
    Effect.map((data) => {
      const ids = data.find((provider) => provider.info.id === providerID)?.plans?.[planID]
      return ids && new Set(ids)
    }),
  )
  const state: { current: ReadonlySet<string> | undefined } = { current: yield* read }
  yield* bus.subscribe([ModelsDev.Event.Refreshed, Event.Updated]).pipe(
    Stream.runForEach(() =>
      read.pipe(
        Effect.flatMap((next) => {
          if (same(next, state.current)) return Effect.void
          state.current = next
          return reload
        }),
      ),
    ),
    Effect.forkScoped({ startImmediately: true }),
  )
  return state
})

function same(left: ReadonlySet<string> | undefined, right: ReadonlySet<string> | undefined) {
  if (!left || !right) return left === right
  return left.size === right.size && [...left].every((id) => right.has(id))
}
