export * as ConfigShellPlugin from "./shell.js"

import { define } from "@opencode-ai/plugin/effect/plugin"
import { Effect } from "effect"
import { Config } from "../../config.js"
import { ShellSelect } from "../../shell/select.js"
import { ConfigEntryObserver } from "./entry-observer.js"

export const Plugin = define({
  id: "opencode.config.shell",
  effect: Effect.fn(function* (ctx) {
    const config = yield* Config.Service
    const shell = yield* ShellSelect.Service
    const loaded = yield* ConfigEntryObserver.observe(config, ctx.event, shell.reload())
    yield* shell.transform((editor) => {
      const configured = Config.latest(loaded.entries, "shell")
      if (configured) editor.configure(configured)
    })
  }),
})
