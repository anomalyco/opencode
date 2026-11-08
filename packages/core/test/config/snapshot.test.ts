import { $ } from "bun"
import { describe, expect } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { Bus } from "@Mackery6969/core/bus"
import { Config } from "@Mackery6969/core/config"
import { ConfigSnapshotPlugin } from "@Mackery6969/core/config/plugin/snapshot"
import { AppNodeBuilder } from "@Mackery6969/core/effect/app-node-builder"
import { Location } from "@Mackery6969/core/location"
import { Plugin } from "@Mackery6969/core/plugin"
import { PluginHost } from "@Mackery6969/core/plugin/host"
import { AbsolutePath } from "@Mackery6969/core/schema"
import { Snapshot } from "@Mackery6969/core/snapshot"
import { Document, Event, Info } from "@Mackery6969/schema/config"
import { Global } from "@Mackery6969/util/global"
import { Effect } from "effect"
import { withTempDir } from "../fixture/tmpdir"
import { it } from "../lib/effect"
import { PluginTestLayer } from "../plugin/fixture"

describe("ConfigSnapshotPlugin.Plugin", () => {
  it.live("applies availability and reloads changed config", () =>
    withTempDir((tmp) =>
      Effect.gen(function* () {
        const project = path.join(tmp.path, "project")
        yield* Effect.promise(async () => {
          await fs.mkdir(project)
          await fs.writeFile(path.join(project, "tracked.txt"), "one\n")
          await $`git init`.cwd(project).quiet()
          await $`git -c core.fsmonitor=false add .`.cwd(project).quiet()
        })

        yield* Effect.gen(function* () {
          const snapshot = yield* Snapshot.Service
          const bus = yield* Bus.Service
          const config = yield* Config.Test
          const plugins = yield* Plugin.Service
          yield* config.setEntries([new Document({ type: "document", info: new Info({ snapshots: false }) })])
          yield* ConfigSnapshotPlugin.Plugin.effect(yield* PluginHost.make(plugins, "test"))

          expect(yield* snapshot.capture()).toBeUndefined()

          yield* config.setEntries([new Document({ type: "document", info: new Info({ snapshots: true }) })])
          yield* bus.publish(Event.Updated, {})
          for (let attempt = 0; attempt < 200; attempt++) {
            if ((yield* snapshot.capture()) !== undefined) return
            yield* Effect.sleep("10 millis")
          }
          yield* Effect.die(new Error("Timed out waiting for snapshot config reload"))
        }).pipe(
          Effect.provide(
            AppNodeBuilder.build(Snapshot.node, [
              Location.node.replace(Location.boundNode(Location.Ref.make({ directory: AbsolutePath.make(project) }))),
              Global.node.replace(Global.layerWith({ data: tmp.path, config: path.join(tmp.path, "config") })),
            ]),
          ),
        )
      }),
    ).pipe(Effect.provide(PluginTestLayer)),
  )
})
