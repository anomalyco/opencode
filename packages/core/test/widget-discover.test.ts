import fs from "fs/promises"
import path from "path"
import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { Bus } from "@opencode/core/bus"
import { Config } from "@opencode/core/config"
import { Watcher } from "@opencode/core/filesystem/watcher"
import { Location } from "@opencode/core/location"
import { AbsolutePath } from "@opencode/core/schema"
import { Widget } from "@opencode/core/widget"
import { Directory } from "@opencode/schema/config"
import { Global } from "@opencode/util/global"
import { FSUtil } from "@opencode/util/fs-util"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { tmpdirScoped } from "./fixture/tmpdir"
import { location } from "./fixture/location"
import { testEffect } from "./lib/effect"

const it = testEffect(Layer.empty)

const layerFor = (project: string, global: string) =>
  AppNodeBuilder.build(
    LayerNode.group([Widget.node, Bus.node, FSUtil.node, Global.node, Location.node, Config.node, Watcher.node]),
    [
      Location.node.replace(
        Layer.succeed(Location.Service, Location.Service.of(location({ directory: AbsolutePath.make(project) }))),
      ),
      Global.node.replace(Global.layerWith({ config: global, home: path.join(global, "home") })),
      Config.node.replace(
        Config.testLayer([new Directory({ type: "directory", path: AbsolutePath.make(project) })]),
      ),
      Watcher.node.replace(Watcher.testLayer),
    ],
  )

const write = async (root: string, name: string, manifest?: unknown, html = "<h1>hi</h1>") => {
  const dir = path.join(root, name)
  await fs.mkdir(dir, { recursive: true })
  await fs.writeFile(path.join(dir, "index.html"), html)
  if (manifest !== undefined) await fs.writeFile(path.join(dir, "widget.json"), JSON.stringify(manifest))
}

describe("Widget.discover", () => {
  it.live("parses requested capabilities and implies lower levels", () =>
    Effect.gen(function* () {
      const tmp = yield* tmpdirScoped()
      const global = path.join(tmp.path, "global")
      const project = path.join(tmp.path, "project")
      const widgets = path.join(global, "widgets")
      yield* Effect.promise(async () => {
        await write(widgets, "reader", { title: "Reader", capabilities: ["read"] })
        await write(widgets, "writer", { title: "Writer", capabilities: ["write"] })
        await write(widgets, "full", { title: "Full", capabilities: ["full"] })
        await write(widgets, "plain", { title: "Plain" })
        await write(widgets, "bogus", { title: "Bogus", capabilities: ["read", "root"] })
      })
      const widget = yield* Widget.Service.pipe(Effect.provide(layerFor(project, global)))
      const list = yield* widget.list()
      const byId = Object.fromEntries(list.map((item) => [item.id, item]))
      expect(byId.reader?.requests).toEqual(["read"])
      expect(byId.writer?.requests).toEqual(["read", "write"])
      expect(byId.full?.requests).toEqual(["read", "write", "full"])
      expect(byId.plain?.requests).toEqual([])
      expect(byId.bogus?.requests).toEqual(["read"])
    }),
  )

  it.live("marks a widget without an index.html as failed but keeps it listed", () =>
    Effect.gen(function* () {
      const tmp = yield* tmpdirScoped()
      const global = path.join(tmp.path, "global")
      const project = path.join(tmp.path, "project")
      const widgets = path.join(global, "widgets")
      yield* Effect.promise(async () => {
        await fs.mkdir(path.join(widgets, "broken"), { recursive: true })
        await fs.writeFile(path.join(widgets, "broken", "widget.json"), JSON.stringify({ title: "Broken" }))
      })
      const widget = yield* Widget.Service.pipe(Effect.provide(layerFor(project, global)))
      const list = yield* widget.list()
      expect(list.find((item) => item.id === "broken")?.state).toEqual({ status: "failed", error: "Missing index.html" })
    }),
  )

  it.live("lets a global widget win over a project widget with the same id", () =>
    Effect.gen(function* () {
      const tmp = yield* tmpdirScoped()
      const global = path.join(tmp.path, "global")
      const project = path.join(tmp.path, "project")
      yield* Effect.promise(async () => {
        await write(path.join(global, "widgets"), "shared", { title: "Global" })
        await write(path.join(project, ".opencode", "widgets"), "shared", { title: "Project" })
      })
      const widget = yield* Widget.Service.pipe(Effect.provide(layerFor(project, global)))
      const list = yield* widget.list()
      const shared = list.filter((item) => item.id === "shared")
      expect(shared).toHaveLength(1)
      expect(shared[0]?.title).toBe("Global")
      expect(shared[0]?.source.type).toBe("global")
    }),
  )

  it.live("serves the bridge helper for the reserved id", () =>
    Effect.gen(function* () {
      const tmp = yield* tmpdirScoped()
      const global = path.join(tmp.path, "global")
      const project = path.join(tmp.path, "project")
      const widget = yield* Widget.Service.pipe(Effect.provide(layerFor(project, global)))
      const helper = yield* widget.read(Widget.BRIDGE_ID, Widget.BRIDGE_ASSET)
      expect(helper?.mime).toBe("text/javascript")
      expect(new TextDecoder().decode(helper!.body)).toContain("window.opencode")
      expect(yield* widget.read(Widget.BRIDGE_ID, "other.js")).toBeUndefined()
    }),
  )
})
