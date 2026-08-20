export * as ConfigShellPlugin from "./shell.js"

import { define } from "@opencode-ai/plugin/effect/plugin"
import { Effect, Stream } from "effect"
import { Config } from "../../config.js"
import { ShellSelect } from "../../shell/select.js"

export const Plugin = define({
  id: "opencode.config.shell",
  effect: Effect.fn(function* (ctx) {
    const config = yield* Config.Service
    const shell = yield* ShellSelect.Service
    const loaded = { entries: yield* config.entries() }
    const reload = config.entries().pipe(
      Effect.tap((entries) => Effect.sync(() => (loaded.entries = entries))),
      Effect.andThen(shell.reload()),
    )
    yield* ctx.event.subscribe().pipe(
      Stream.filter((event) => event.type === "config.updated"),
      Stream.runForEach(() => reload),
      Effect.forkScoped({ startImmediately: true }),
    )
    loaded.entries = yield* config.entries()
    yield* shell.transform((draft) => {
      const configured = Config.latest(loaded.entries, "shell")
      if (configured) draft.configure(configured)
    })
  }),
})
