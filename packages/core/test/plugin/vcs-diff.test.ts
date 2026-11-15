import { expect } from "bun:test"
import { Plugin } from "@opencode/core/plugin"
import { PluginHost } from "@opencode/core/plugin/host"
import { Effect } from "effect"
import { testEffect } from "../lib/effect"
import { PluginTestLayer } from "./fixture"

const it = testEffect(PluginTestLayer)

it.live("plugins pass untracked to the VCS provider through vcs.diff", () =>
  Effect.gen(function* () {
    const plugins = yield* Plugin.Service
    const context = yield* PluginHost.make(plugins, "test")
    const untracked = new Array<string | undefined>()
    yield* context.vcs.transform((editor) => {
      editor.add({
        id: "recording",
        name: "Recording",
        info: () => Effect.succeed({ branch: {} }),
        branches: () => Effect.succeed([]),
        status: () => Effect.succeed([]),
        diff: (input) => Effect.sync(() => void untracked.push(input.untracked)).pipe(Effect.as([])),
      })
      editor.default.set("recording")
    })

    yield* context.vcs.diff({ mode: "working", untracked: "folders" })
    yield* context.vcs.diff({ mode: "working" })

    expect(untracked).toEqual(["folders", undefined])
  }),
)
