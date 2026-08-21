export * as ConfigEntryObserver from "./entry-observer.js"

import type { EventDomain } from "@opencode-ai/plugin/effect/event"
import { Effect, Stream } from "effect"
import { Config } from "../../config.js"

export const observe = Effect.fnUntraced(function* (
  config: Config.Interface,
  event: EventDomain,
  reload: Effect.Effect<void>,
) {
  const loaded = { entries: yield* config.entries() }
  const refresh = config.entries().pipe(
    Effect.tap((entries) => Effect.sync(() => (loaded.entries = entries))),
    Effect.andThen(reload),
  )
  yield* event.subscribe().pipe(
    Stream.filter((event) => event.type === "config.updated"),
    Stream.runForEach(() => refresh),
    Effect.forkScoped({ startImmediately: true }),
  )
  // Close the race between the first read and establishing the subscription.
  loaded.entries = yield* config.entries()
  return loaded
})
