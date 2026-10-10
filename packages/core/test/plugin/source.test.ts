import { describe, expect } from "bun:test"
import fs from "node:fs/promises"
import path from "node:path"
import { Effect, Layer } from "effect"
import { Config } from "@opencode/core/config"
import { ConfigPluginSource } from "@opencode/core/config/plugin/source"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { Watcher } from "@opencode/core/filesystem/watcher"
import { Location } from "@opencode/core/location"
import { Document, Info } from "@opencode/schema/config"
import { tmpdirScoped } from "../fixture/tmpdir"
import { tempLocationLayer } from "../fixture/location"
import { testEffect } from "../lib/effect"

const link = (target: string, source: string) =>
  fs.symlink(target, source, process.platform === "win32" ? "junction" : undefined)

const it = testEffect(Layer.empty)

describe("ConfigPluginSource", () => {
  it.live("keeps a configured plugin whose directory symlink is retargeted", () =>
    Effect.gen(function* () {
      const directory = yield* tmpdirScoped()
      const first = path.join(directory.path, "first")
      const second = path.join(directory.path, "second")
      const source = path.join(directory.path, "plugin")
      yield* Effect.promise(async () => {
        await fs.mkdir(first, { recursive: true })
        await fs.mkdir(second, { recursive: true })
        await Bun.write(path.join(first, "index.ts"), 'export default { id: "first", setup() {} }')
        await Bun.write(path.join(second, "index.ts"), 'export default { id: "second", setup() {} }')
        await link(first, source)
      })

      const plugins = yield* ConfigPluginSource.Service.pipe(
        Effect.provide(
          AppNodeBuilder.build(ConfigPluginSource.node, [
            Config.node.replace(
              Config.testLayer([new Document({ type: "document", info: new Info({ plugins: [source] }) })]),
            ),
            Location.node.replace(tempLocationLayer),
            Watcher.node.replace(Watcher.layer({ enabled: false }).pipe(Layer.provide(Watcher.nativeLayer))),
          ]),
        ),
      )
      expect(yield* plugins.operations()).toMatchObject([{ type: "add", target: source }])

      // A dotfiles tool (nix, home-manager, stow) repoints the symlink; the next
      // scan must follow it instead of the target resolved at first sight.
      yield* Effect.promise(async () => {
        await fs.unlink(source)
        await link(second, source)
      })
      expect(yield* plugins.operations()).toMatchObject([{ type: "add", target: source }])
    }),
  )
})
