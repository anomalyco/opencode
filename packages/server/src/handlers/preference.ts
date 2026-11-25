import { KV } from "@opencode/core/kv"
import { ForbiddenError } from "@opencode/protocol/errors"
import type { PreferenceUpdate } from "@opencode/protocol/groups/preference"
import { Effect, Predicate } from "effect"
import { HttpApiSchema } from "effect/http-api"
import { baseFlag } from "../base-flag"

// A namespace's keys are stored as `preference:<name>:<key>`. Names hold no `:`, so no prefix covers another's keys.
const prefix = (name: string) => `preference:${name}:`

/**
 * `preference.*` HTTP routes in the `server.experimental` group: the web app's preferences, one global store per
 * server. Every route needs the `web_preferences` flag. The last write wins; there are no revisions or change events.
 */
export const makePreference = Effect.gen(function* () {
  const enabled = yield* baseFlag("web_preferences")
  const kv = yield* KV.Service
  const requireEnabled = Effect.gen(function* () {
    if (yield* enabled) return
    return yield* new ForbiddenError({ message: "Web preferences are disabled; enable experimental.web_preferences" })
  })
  const scan = (name: string, after?: string): Effect.Effect<readonly KV.Entry[]> =>
    Effect.gen(function* () {
      const page = yield* kv.scan({ prefix: prefix(name), after, limit: 1000 })
      if (!page.next) return page.entries
      return [...page.entries, ...(yield* scan(name, page.next))]
    })

  return {
    items: Effect.fn("PreferenceHandler.items")(function* (name: string) {
      yield* requireEnabled
      const entries = yield* scan(name)
      return {
        data: Object.fromEntries(
          entries.flatMap((entry) =>
            Predicate.isString(entry.value) ? [[entry.key.slice(prefix(name).length), entry.value] as const] : [],
          ),
        ),
      }
    }),
    update: Effect.fn("PreferenceHandler.update")(function* (name: string, payload: PreferenceUpdate) {
      yield* requireEnabled
      yield* Effect.forEach(Object.entries(payload.insert), ([key, value]) => kv.set(prefix(name) + key, value), {
        discard: true,
      })
      yield* Effect.forEach(payload.remove, (key) => kv.remove(prefix(name) + key), { discard: true })
      return HttpApiSchema.NoContent.make()
    }),
    clear: Effect.fn("PreferenceHandler.clear")(function* (name: string) {
      yield* requireEnabled
      const entries = yield* scan(name)
      yield* Effect.forEach(entries, (entry) => kv.remove(entry.key), { discard: true })
      return HttpApiSchema.NoContent.make()
    }),
  }
})
