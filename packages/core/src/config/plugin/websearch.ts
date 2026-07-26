export * as ConfigWebSearchPlugin from "./websearch"

import { define } from "@opencode-ai/plugin/v2/effect/plugin"
import { Effect, Stream } from "effect"
import { Config } from "../../config"

export const Plugin = define({
  id: "opencode.config.websearch",
  effect: Effect.fn(function* (ctx) {
    const config = yield* Config.Service
    const loaded = { entries: yield* config.entries() }
    yield* ctx.websearch.transform((websearch) => {
      const providerID = Config.latest(loaded.entries, "websearch")?.provider
      if (providerID) websearch.default.set(providerID)
    })
    yield* ctx.event.subscribe().pipe(
      Stream.filter((event) => event.type === "config.updated"),
      Stream.runForEach(() =>
        config.entries().pipe(
          Effect.tap((entries) => Effect.sync(() => (loaded.entries = entries))),
          Effect.andThen(ctx.websearch.reload()),
        ),
      ),
      Effect.forkScoped({ startImmediately: true }),
    )
  }),
})
