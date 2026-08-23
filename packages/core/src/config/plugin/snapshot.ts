export * as ConfigSnapshotPlugin from "./snapshot.js"

import { define } from "@opencode-ai/plugin/effect/plugin"
import { Effect } from "effect"
import { Config } from "../../config.js"
import { Snapshot } from "../../snapshot.js"
import { ConfigEntryObserver } from "./entry-observer.js"

export const Plugin = define({
  id: "opencode.config.snapshot",
  effect: Effect.fn(function* (ctx) {
    const config = yield* Config.Service
    const snapshot = yield* Snapshot.Service
    const loaded = yield* ConfigEntryObserver.observe(config, ctx.event, snapshot.reload())
    yield* snapshot.transform((draft) => {
      const configured = Config.latest(loaded.entries, "snapshots")
      if (configured === undefined) return
      draft.configure(configured)
    })
  }),
})
