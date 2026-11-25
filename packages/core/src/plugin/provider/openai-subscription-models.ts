export * as OpenAISubscriptionModels from "./openai-subscription-models.js"

import { Event } from "@opencode/schema/config"
import { Effect, Stream } from "effect"
import { Bus } from "../../bus.js"
import { Config } from "../../config.js"
import { Flag } from "../../flag.js"
import { Provider } from "../../provider.js"
import { ModelsDev } from "../../models-dev.js"

// Temporary stopgap, OpenAI-only, until opencode moves to the official v2 models.dev API. The Codex and Sign in with
// ChatGPT sign-ins can use only some OpenAI models, and models.dev lists them as the hidden `openai-codex` and
// `openai-chatgpt` providers so the lists can change without a release. The v2 API returns them by default, so this
// special case goes away then, though they'll still need handling so they don't show up as separate providers.

/**
 * Keeps a copy of the model IDs models.dev lists for one OpenAI subscription sign-in, and runs `reload` when a catalog
 * refresh changes them. `current` is undefined when the catalog has no list for it (a cache or bundled snapshot from
 * before it was added, or a custom mirror) or the list is empty, so callers fall back to their own rules.
 */
export const track = Effect.fnUntraced(function* (
  list: "openai-codex" | "openai-chatgpt",
  reload: Effect.Effect<void>,
) {
  const modelsDev = yield* ModelsDev.Service
  const bus = yield* Bus.Service
  const config = yield* Config.Service
  const flags = yield* Flag.Service
  // Same catalog view as the models.dev plugin, so both read one cached copy.
  const read = config.entries().pipe(
    Effect.flatMap((entries) => modelsDev.get(flags.resolve(entries).recommended_api.enabled)),
    Effect.map((data) => {
      const ids = data.find((provider) => provider.info.id === Provider.ID.openai)?.subscriptions?.[list]
      // An empty list is treated as missing, so a bad catalog edit can't hide every model.
      return ids?.length ? new Set(ids) : undefined
    }),
  )
  const state: { current: ReadonlySet<string> | undefined } = { current: yield* read }
  const update = read.pipe(
    Effect.flatMap((next) => {
      if (same(next, state.current)) return Effect.void
      state.current = next
      return reload
    }),
  )
  yield* bus.subscribe([ModelsDev.Event.Refreshed, Event.Updated], { overflow: "slide" }).pipe(
    Stream.runForEach(() => update),
    Effect.forkScoped({ startImmediately: true }),
  )
  // A refresh between the first read and the subscription published to nobody here; on a cold cache that read
  // served the bundled snapshot, so read again instead of waiting for the next refresh.
  yield* update
  return state
})

function same(left: ReadonlySet<string> | undefined, right: ReadonlySet<string> | undefined) {
  if (!left || !right) return left === right
  return left.size === right.size && [...left].every((id) => right.has(id))
}
