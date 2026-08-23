export * as ConfigToolOutputPlugin from "./tool-output.js"

import { define } from "@opencode-ai/plugin/effect/plugin"
import { Effect } from "effect"
import { Config } from "../../config.js"
import { ToolOutput } from "../../tool-output.js"
import { ConfigEntryObserver } from "./entry-observer.js"

export const Plugin = define({
  id: "opencode.config.tool-output",
  effect: Effect.fn(function* (ctx) {
    const config = yield* Config.Service
    const output = yield* ToolOutput.Service
    const loaded = yield* ConfigEntryObserver.observe(config, ctx.event, output.reload())
    yield* output.transform((draft) => {
      const configured = Config.latest(loaded.entries, "tool_output")
      if (!configured) return
      draft.configure({
        ...(configured.max_lines === undefined ? {} : { maxLines: configured.max_lines }),
        ...(configured.max_bytes === undefined ? {} : { maxBytes: configured.max_bytes }),
      })
    })
  }),
})
