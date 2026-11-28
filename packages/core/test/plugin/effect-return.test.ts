import { expect } from "bun:test"
import { Plugin } from "@opencode/core/plugin"
import { Effect } from "effect"
import { testEffect } from "../lib/effect"
import { PluginTestLayer } from "./fixture"

const it = testEffect(PluginTestLayer)

it.live("fails a plugin whose effect returns a Promise instead of hanging activation", () =>
  Effect.gen(function* () {
    const plugins = yield* Plugin.Service
    // User plugin code is never type-checked: an async `effect` passes the loader's
    // "is a function" check, so simulate it with a cast instead of `define`.
    const generations = [
      {
        id: "hang",
        revision: "test",
        effect: (async () => ({})) as unknown as Plugin.Generation["effect"],
      },
      {
        id: "hang-hooks",
        revision: "test",
        effect: (async () => ({ "tool.execute.before": async () => {} })) as unknown as Plugin.Generation["effect"],
      },
    ] satisfies Plugin.Generation[]
    // Activation must finish promptly; without the fix it never returns.
    yield* plugins.activate(generations).pipe(Effect.timeout("5 seconds"))
    const list = yield* plugins.list()
    for (const id of ["hang", "hang-hooks"]) {
      const entry = list.find((item) => item.id === Plugin.ID.make(id))
      expect(entry?.state.status).toBe("failed")
      expect(entry?.state).toMatchObject({ error: expect.stringContaining("must return an Effect") })
    }
    // Readiness settles too, so the provider catalog stays available.
    yield* plugins.awaitActivation.pipe(Effect.timeout("5 seconds"))
  }),
)
