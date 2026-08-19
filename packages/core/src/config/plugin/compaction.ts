export * as ConfigCompactionPlugin from "./compaction.js"

import { define } from "@opencode-ai/plugin/effect/plugin"
import { Effect, Stream } from "effect"
import { Config } from "../../config.js"
import { SessionCompaction } from "../../session/compaction.js"

export const Plugin = define({
  id: "opencode.config.compaction",
  effect: Effect.fn(function* (ctx) {
    const config = yield* Config.Service
    const compaction = yield* SessionCompaction.Service
    const loaded = { entries: yield* config.entries() }
    const reload = config.entries().pipe(
      Effect.tap((entries) => Effect.sync(() => (loaded.entries = entries))),
      Effect.andThen(compaction.reload()),
    )
    yield* ctx.event.subscribe().pipe(
      Stream.filter((event) => event.type === "config.updated"),
      Stream.runForEach(() => reload),
      Effect.forkScoped({ startImmediately: true }),
    )
    loaded.entries = yield* config.entries()
    yield* compaction.transform((draft) => {
      for (const entry of loaded.entries) {
        if (entry.type !== "document" || !entry.info.compaction) continue
        draft.configure({
          ...(entry.info.compaction.auto === undefined ? {} : { auto: entry.info.compaction.auto }),
          ...(entry.info.compaction.buffer === undefined ? {} : { buffer: entry.info.compaction.buffer }),
          ...(entry.info.compaction.keep?.tokens === undefined
            ? {}
            : { tokens: entry.info.compaction.keep.tokens }),
        })
      }
    })
  }),
})
