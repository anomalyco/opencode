export * as ConfigWebSearchPlugin from "./websearch.js"

import { define } from "@opencode-ai/plugin/effect/plugin"
import { Effect } from "effect"
import { Config } from "../../config.js"
import { ConfigEntryObserver } from "./entry-observer.js"

export const Plugin = define({
  id: "opencode.config.websearch",
  effect: Effect.fn(function* (ctx) {
    const config = yield* Config.Service
    const loaded = yield* ConfigEntryObserver.observe(config, ctx.event, ctx.websearch.reload())
    yield* ctx.websearch.transform((websearch) => {
      const selection = Config.latest(loaded.entries, "websearch")
      if (selection === false) websearch.default.set(false)
      if (selection) websearch.default.set(selection.provider)
    })
  }),
})
