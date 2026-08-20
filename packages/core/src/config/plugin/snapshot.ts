export * as ConfigSnapshotPlugin from "./snapshot.js"

import { define } from "@opencode-ai/plugin/effect/plugin"
import { Effect, Stream } from "effect"
import { Config } from "../../config.js"
import { Snapshot } from "../../snapshot.js"

export const Plugin = define({
  id: "opencode.config.snapshot",
  effect: Effect.fn(function* (ctx) {
    const config = yield* Config.Service
    const snapshot = yield* Snapshot.Service
    const loaded = { entries: yield* config.entries() }
    const reload = config.entries().pipe(
      Effect.tap((entries) => Effect.sync(() => (loaded.entries = entries))),
      Effect.andThen(snapshot.reload()),
    )
    yield* ctx.event.subscribe().pipe(
      Stream.filter((event) => event.type === "config.updated"),
      Stream.runForEach(() => reload),
      Effect.forkScoped({ startImmediately: true }),
    )
    loaded.entries = yield* config.entries()
    yield* snapshot.transform((draft) => {
      const configured = Config.latest(loaded.entries, "snapshots")
      if (configured === undefined) return
      draft.configure(configured)
    })
  }),
})
