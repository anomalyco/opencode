export * as ConfigLocationWatcherPlugin from "./location-watcher.js"

import { define } from "@opencode-ai/plugin/effect/plugin"
import { Effect, Stream } from "effect"
import { Config } from "../../config.js"
import { LocationWatcherPolicy } from "../../filesystem/location-watcher-policy.js"

export const Plugin = define({
  id: "opencode.config.location-watcher",
  effect: Effect.fn(function* (ctx) {
    const config = yield* Config.Service
    const policy = yield* LocationWatcherPolicy.Service
    const loaded = { entries: yield* config.entries() }
    const reload = config.entries().pipe(
      Effect.tap((entries) => Effect.sync(() => (loaded.entries = entries))),
      Effect.andThen(policy.reload()),
    )
    yield* ctx.event.subscribe().pipe(
      Stream.filter((event) => event.type === "config.updated"),
      Stream.runForEach(() => reload),
      Effect.forkScoped({ startImmediately: true }),
    )
    loaded.entries = yield* config.entries()
    yield* policy.transform((draft) => {
      for (const entry of loaded.entries) {
        if (entry.type !== "document" || !entry.info.watcher?.ignore) continue
        draft.add(entry.info.watcher.ignore)
      }
    })
  }),
})
