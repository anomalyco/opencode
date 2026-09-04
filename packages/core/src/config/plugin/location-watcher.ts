export * as ConfigLocationWatcherPlugin from "./location-watcher.js"

import { define } from "@opencode-ai/plugin/effect/plugin"
import { Effect } from "effect"
import { Config } from "../../config.js"
import { LocationWatcherPolicy } from "../../filesystem/location-watcher-policy.js"
import { ConfigEntryObserver } from "./entry-observer.js"

export const Plugin = define({
  id: "opencode.config.location-watcher",
  effect: Effect.fn(function* (ctx) {
    const config = yield* Config.Service
    const policy = yield* LocationWatcherPolicy.Service
    const loaded = yield* ConfigEntryObserver.observe(config, ctx.event, policy.reload())
    yield* policy.transform((editor) => {
      for (const entry of loaded.entries) {
        if (entry.type !== "document" || !entry.info.watcher?.ignore) continue
        editor.add(entry.info.watcher.ignore)
      }
    })
  }),
})
