import path from "path"
import { describe, expect } from "bun:test"
import { NodeFileSystem } from "@effect/platform-node"
import { Document, Info } from "@opencode/schema/config"
import { FSUtil } from "@opencode/util/fs-util"
import { Effect, Layer, Queue, Stream } from "effect"
import { Config } from "@opencode/core/config"
import { ConfigPluginSource } from "@opencode/core/config/plugin/source"
import { Watcher } from "@opencode/core/filesystem/watcher"
import { Location } from "@opencode/core/location"
import { AbsolutePath } from "@opencode/core/schema"
import { location } from "../fixture/location"
import { drain } from "../lib/clock"
import { tmpdirScoped } from "../fixture/tmpdir"
import { testEffect } from "../lib/effect"

const it = testEffect(Layer.empty)

describe("ConfigPluginSource", () => {
  it.effect("ignores dependency and VCS writes inside a configured plugin directory", () =>
    Effect.gen(function* () {
      const directory = yield* tmpdirScoped()
      const plugin = path.join(directory.path, "external/greeter")
      const entry = path.join(plugin, "index.ts")
      yield* Effect.promise(() => Bun.write(entry, "export default {}"))
      yield* Effect.gen(function* () {
        const source = yield* ConfigPluginSource.Service
        const watcher = yield* Watcher.Test
        expect(yield* source.operations()).toMatchObject([{ type: "add", target: plugin }])
        expect(yield* watcher.subscriptions()).toEqual([
          { path: plugin, type: "directory", ignore: FSUtil.ignoreGlobs.toSorted() },
        ])
        const changes = yield* Queue.unbounded<void>()
        yield* source.changes().pipe(
          Stream.runForEach(() => Queue.offer(changes, undefined)),
          Effect.forkScoped({ startImmediately: true }),
        )
        yield* drain

        yield* watcher.emit({ path: path.join(plugin, "node_modules/dep/index.js"), type: "create" })
        yield* watcher.emit({ path: path.join(plugin, ".git/index"), type: "update" })
        yield* drain
        expect(yield* Queue.size(changes)).toBe(0)

        yield* watcher.emit({ path: entry, type: "update" })
        yield* Queue.take(changes)
      }).pipe(
        Effect.provide(
          ConfigPluginSource.layer.pipe(
            Layer.provideMerge(
              Layer.mergeAll(
                Config.testLayer([new Document({ type: "document", info: new Info({ plugins: [plugin] }) })]),
                Watcher.testLayer,
                FSUtil.layer.pipe(Layer.provide(NodeFileSystem.layer)),
                Layer.succeed(
                  Location.Service,
                  Location.Service.of(location(Location.Ref.make({ directory: AbsolutePath.make(directory.path) }))),
                ),
              ),
            ),
          ),
        ),
      )
    }),
  )
})
