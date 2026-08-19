import { describe, expect } from "bun:test"
import { Bus } from "@opencode-ai/core/bus"
import { Config } from "@opencode-ai/core/config"
import { ConfigToolOutputPlugin } from "@opencode-ai/core/config/plugin/tool-output"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { Plugin } from "@opencode-ai/core/plugin"
import { PluginHost } from "@opencode-ai/core/plugin/host"
import { ToolOutput } from "@opencode-ai/core/tool-output"
import { Document, Event, Info } from "@opencode-ai/schema/config"
import { ConfigToolOutput } from "@opencode-ai/schema/config/tool-output"
import { Global } from "@opencode-ai/util/global"
import { Effect } from "effect"
import { tmpdir } from "../fixture/tmpdir"
import { it } from "../lib/effect"
import { PluginTestLayer } from "../plugin/fixture"

describe("ConfigToolOutputPlugin.Plugin", () => {
  it.live("applies limits and reloads changed config", () =>
    Effect.acquireUseRelease(
      Effect.promise(() => tmpdir()),
      (tmp) =>
        Effect.gen(function* () {
          const output = yield* ToolOutput.Service
          const bus = yield* Bus.Service
          const config = yield* Config.Test
          const plugins = yield* Plugin.Service
          yield* ConfigToolOutputPlugin.Plugin.effect(yield* PluginHost.make(plugins))

          expect(yield* isTruncated(output)).toBe(true)

          yield* config.setEntries([document({ max_lines: 2, max_bytes: 1_000 })])
          yield* bus.publish(Event.Updated, {})
          yield* waitUntil(isTruncated(output).pipe(Effect.map((value) => !value)))
        }).pipe(
          Effect.provide(AppNodeBuilder.build(ToolOutput.node, [[Global.node, Global.layerWith({ data: tmp.path })]])),
        ),
      (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
    ).pipe(Effect.provide(PluginTestLayer), Effect.provide(Config.testLayer([document({ max_lines: 1 })]))),
  )
})

function document(toolOutput: ConstructorParameters<typeof ConfigToolOutput.Info>[0]) {
  return new Document({ type: "document", info: new Info({ tool_output: new ConfigToolOutput.Info(toolOutput) }) })
}

const isTruncated = Effect.fnUntraced(function* (output: ToolOutput.Interface) {
  return (yield* output.truncate({ content: "one\ntwo" })).metadata?.truncated === true
})

const waitUntil = Effect.fnUntraced(function* (condition: Effect.Effect<boolean>) {
  for (let attempt = 0; attempt < 200; attempt++) {
    if (yield* condition) return
    yield* Effect.sleep("10 millis")
  }
  yield* Effect.die(new Error("Timed out waiting for tool output config reload"))
})
