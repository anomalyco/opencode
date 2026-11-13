import { expect } from "bun:test"
import { Plugin } from "@opencode/core/plugin"
import { PluginHost } from "@opencode/core/plugin/host"
import { PluginPromise } from "@opencode/core/plugin/promise"
import { Effect } from "effect"
import { testEffect } from "../lib/effect"
import { PluginTestLayer } from "./fixture"

const it = testEffect(PluginTestLayer)

it.live("Effect and Promise plugins wait for an idle session and get its result", () =>
  Effect.gen(function* () {
    const plugins = yield* Plugin.Service
    const context = yield* PluginHost.make(plugins, "test")
    const created = yield* context.session.create({ title: "Plugin wait" })

    expect(yield* context.session.wait({ sessionID: created.id })).toEqual({})

    let waited: unknown
    yield* PluginPromise.fromPromise({
      id: "test.session-wait",
      async setup(ctx) {
        waited = await ctx.session.wait({ sessionID: created.id })
      },
    }).effect(context)
    expect(waited).toEqual({})
  }),
)
