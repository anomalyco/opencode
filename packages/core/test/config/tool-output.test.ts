import { describe, expect } from "bun:test"
import { Bus } from "@Mackery6969/core/bus"
import { Config } from "@Mackery6969/core/config"
import { ConfigToolOutputPlugin } from "@Mackery6969/core/config/plugin/tool-output"
import { AppNodeBuilder } from "@Mackery6969/core/effect/app-node-builder"
import { Plugin } from "@Mackery6969/core/plugin"
import { PluginHost } from "@Mackery6969/core/plugin/host"
import { ToolOutput } from "@Mackery6969/core/tool-output"
import { Document, Event, Info } from "@Mackery6969/schema/config"
import { ConfigToolOutput } from "@Mackery6969/schema/config/tool-output"
import { Global } from "@Mackery6969/util/global"
import { Effect } from "effect"
import { withTempDir } from "../fixture/tmpdir"
import { it } from "../lib/effect"
import { PluginTestLayer } from "../plugin/fixture"

describe("ConfigToolOutputPlugin.Plugin", () => {
  it.live("applies limits and reloads changed config", () =>
    withTempDir((tmp) =>
      Effect.gen(function* () {
        const output = yield* ToolOutput.Service
        const bus = yield* Bus.Service
        const config = yield* Config.Test
        const plugins = yield* Plugin.Service
        yield* config.setEntries([
          new Document({
            type: "document",
            info: new Info({ tool_output: new ConfigToolOutput.Info({ max_lines: 1 }) }),
          }),
        ])
        yield* ConfigToolOutputPlugin.Plugin.effect(yield* PluginHost.make(plugins, "test"))

        expect((yield* output.truncate({ content: [{ type: "text", text: "one\ntwo" }] })).metadata?.truncated).toBe(
          true,
        )

        yield* config.setEntries([
          new Document({
            type: "document",
            info: new Info({
              tool_output: new ConfigToolOutput.Info({ max_lines: 2, max_bytes: 1_000 }),
            }),
          }),
        ])
        yield* bus.publish(Event.Updated, {})
        for (let attempt = 0; attempt < 200; attempt++) {
          const result = yield* output.truncate({ content: [{ type: "text", text: "one\ntwo" }] })
          if (result.metadata?.truncated === false) return
          yield* Effect.sleep("10 millis")
        }
        yield* Effect.die(new Error("Timed out waiting for tool output config reload"))
      }).pipe(
        Effect.provide(
          AppNodeBuilder.build(ToolOutput.node, [Global.node.replace(Global.layerWith({ data: tmp.path }))]),
        ),
      ),
    ).pipe(Effect.provide(PluginTestLayer)),
  )
})
