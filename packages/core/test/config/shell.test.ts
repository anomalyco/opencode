import { describe, expect } from "bun:test"
import { Bus } from "@opencode-ai/core/bus"
import { Config } from "@opencode-ai/core/config"
import { ConfigShellPlugin } from "@opencode-ai/core/config/plugin/shell"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { Plugin } from "@opencode-ai/core/plugin"
import { PluginHost } from "@opencode-ai/core/plugin/host"
import { ShellSelect } from "@opencode-ai/core/shell/select"
import { Document, Event, Info } from "@opencode-ai/schema/config"
import { FSUtil } from "@opencode-ai/util/fs-util"
import { Effect, Layer } from "effect"
import { testEffect } from "../lib/effect"
import { PluginTestLayer } from "../plugin/fixture"

const it = testEffect(Layer.merge(PluginTestLayer, AppNodeBuilder.build(ShellSelect.node)))

describe("ConfigShellPlugin.Plugin", () => {
  it.live("applies the preferred shell and reloads changed config", () =>
    Effect.gen(function* () {
      const shell = yield* ShellSelect.Service
      const bus = yield* Bus.Service
      const config = yield* Config.Test
      const plugins = yield* Plugin.Service
      yield* ConfigShellPlugin.Plugin.effect(yield* PluginHost.make(plugins))

      const configured = process.platform === "win32" ? FSUtil.windowsPath(process.execPath) : process.execPath
      expect(yield* shell.preferred()).toBe(configured)

      yield* config.setEntries([])
      yield* bus.publish(Event.Updated, {})
      for (let attempt = 0; attempt < 200; attempt++) {
        if ((yield* shell.preferred()) !== configured) return
        yield* Effect.sleep("10 millis")
      }
      yield* Effect.die(new Error("Timed out waiting for shell config reload"))
    }).pipe(
      Effect.provide(
        Config.testLayer([new Document({ type: "document", info: new Info({ shell: process.execPath }) })]),
      ),
    ),
  )
})
