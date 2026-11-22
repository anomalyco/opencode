import { describe, expect } from "bun:test"
import { Bus } from "@opencode/core/bus"
import { Config } from "@opencode/core/config"
import { ConfigToolOutputPlugin } from "@opencode/core/config/plugin/tool-output"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { Plugin } from "@opencode/core/plugin"
import { PluginHost } from "@opencode/core/plugin/host"
import { ToolOutput } from "@opencode/core/tool-output"
import { Document, Event, Info } from "@opencode/schema/config"
import { ConfigExperimental } from "@opencode/schema/config/experimental"
import { ConfigToolOutput } from "@opencode/schema/config/tool-output"
import { Global } from "@opencode/util/global"
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

  it.live("cuts head and tail with full_codemode, and only the head without it", () =>
    withTempDir((tmp) =>
      Effect.gen(function* () {
        const output = yield* ToolOutput.Service
        const bus = yield* Bus.Service
        const config = yield* Config.Test
        const plugins = yield* Plugin.Service
        const text = Array.from({ length: 10 }, (_, index) => `line ${index + 1}`).join("\n")
        const configure = (full_codemode: boolean) =>
          config.setEntries([
            new Document({
              type: "document",
              info: new Info({
                experimental: new ConfigExperimental.Info({ full_codemode }),
                tool_output: new ConfigToolOutput.Info({ max_lines: 4 }),
              }),
            }),
          ])
        const shown = output
          .truncate({ content: [{ type: "text", text }] })
          .pipe(
            Effect.map((result) =>
              result.content.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("\n"),
            ),
          )
        yield* configure(true)
        yield* ConfigToolOutputPlugin.Plugin.effect(yield* PluginHost.make(plugins, "test"))
        expect(yield* shown).toMatch(/^line 1\n\[… 7 lines \(.+\) cut from the middle; .+\]\nline 9\nline 10$/)

        yield* configure(false)
        yield* bus.publish(Event.Updated, {})
        for (let attempt = 0; attempt < 200; attempt++) {
          if ((yield* shown).startsWith("line 1\nline 2\nline 3\nline 4\n[showing lines 1-4 of 10; ")) return
          yield* Effect.sleep("10 millis")
        }
        yield* Effect.die(new Error("Timed out waiting for the head-only strategy"))
      }).pipe(
        Effect.provide(
          AppNodeBuilder.build(ToolOutput.node, [Global.node.replace(Global.layerWith({ data: tmp.path }))]),
        ),
      ),
    ).pipe(Effect.provide(PluginTestLayer)),
  )
})
