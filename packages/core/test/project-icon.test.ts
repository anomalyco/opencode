import { expect } from "bun:test"
import path from "path"
import fs from "fs/promises"
import { Effect, Fiber, Stream } from "effect"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { Project } from "@opencode/core/project"
import { ProjectIcon } from "@opencode/core/project/icon"
import { ProjectSchema } from "@opencode/core/project/schema"
import { ProjectTable } from "@opencode/core/project/sql"
import { Database } from "@opencode/core/database/database"
import { Bus } from "@opencode/core/bus"
import { AbsolutePath } from "@opencode/core/schema"
import { FSUtil } from "@opencode/util/fs-util"
import { tmpdirScoped } from "./fixture/tmpdir"
import { testEffect } from "./lib/effect"

const it = testEffect(AppNodeBuilder.build(LayerNode.group([Project.node, Database.node, Bus.node, FSUtil.node])))
const svg = '<svg xmlns="http://www.w3.org/2000/svg"/>'
const url = `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`

for (const kind of ["ranked appiconset", "escaping symlink", "oversized file"] as const) {
  it.live(`discovers the expected icon with a ${kind}`, () =>
    Effect.gen(function* () {
      const tmp = yield* tmpdirScoped()
      const root = path.join(tmp.path, "project")
      const filesystem = yield* FSUtil.Service
      const db = (yield* Database.Service).db
      const id = Project.ID.make("icons")
      yield* Effect.promise(() => Bun.write(path.join(root, "public/favicon.svg"), svg))
      if (kind === "ranked appiconset") {
        yield* Effect.promise(() => Bun.write(path.join(root, "Assets.xcassets/AppIcon.appiconset/000.png"), "other"))
        yield* Effect.promise(() =>
          Bun.write(path.join(root, "Assets.xcassets/AppIcon.appiconset/icon256.svg"), svg + " "),
        )
      }
      if (kind === "escaping symlink") {
        yield* Effect.promise(() => Bun.write(path.join(tmp.path, "outside.svg"), "outside"))
        yield* Effect.promise(() => fs.mkdir(path.join(root, "assets")))
        yield* Effect.promise(() =>
          fs.symlink(path.join(tmp.path, "outside.svg"), path.join(root, "assets/app-icon.svg")),
        )
      }
      if (kind === "oversized file")
        yield* Effect.promise(() => Bun.write(path.join(root, "assets/app-icon.svg"), "x".repeat(64 * 1024 + 1)))
      yield* db
        .insert(ProjectTable)
        .values({ id, worktree: AbsolutePath.make(root), sandboxes: [] })
        .run()
      const row = yield* ProjectIcon.refresh(filesystem, db, id)
      expect(row?.icon_url).toBe(
        kind === "ranked appiconset" ? `data:image/svg+xml;base64,${Buffer.from(svg + " ").toString("base64")}` : url,
      )
    }),
  )
}

it.live("resolves in the background, preserves overrides, and only writes changed content", () =>
  Effect.gen(function* () {
    const tmp = yield* tmpdirScoped()
    const project = yield* Project.Service
    const bus = yield* Bus.Service
    const filesystem = yield* FSUtil.Service
    const db = (yield* Database.Service).db
    yield* Effect.promise(() => Bun.write(path.join(tmp.path, "favicon.svg"), svg))
    const updated = yield* bus
      .subscribe(ProjectSchema.Event.Updated)
      .pipe(Stream.take(1), Stream.runCollect, Effect.forkScoped({ startImmediately: true }))
    const resolved = yield* project.resolve(AbsolutePath.make(tmp.path))
    expect((yield* Fiber.join(updated))[0]?.data.icon?.url).toBe(url)
    yield* project.update({ projectID: resolved.id, icon: { override: "my-icon", color: "blue" } })
    const before = (yield* project.list())[0]
    expect(yield* ProjectIcon.refresh(filesystem, db, resolved.id)).toBeUndefined()
    expect((yield* project.list())[0]).toEqual(before)
    yield* Effect.promise(() => Bun.write(path.join(tmp.path, "favicon.svg"), svg + " "))
    const changed = yield* ProjectIcon.refresh(filesystem, db, resolved.id)
    expect(changed?.icon_url).not.toBe(url)
    expect(changed).toMatchObject({ icon_url_override: "my-icon", icon_color: "blue" })
  }),
)

for (const fixture of [
  { name: "root Composer SVG", file: "AppIcon.icon/Assets/logo.svg", manifest: "AppIcon.icon/icon.json" },
  { name: "app Composer PNG", file: "app/AppIcon.icon/Assets/logo.png", manifest: "app/AppIcon.icon/icon.json" },
  {
    name: "assets Composer SVG",
    file: "assets/AppIcon.icon/Assets/logo.svg",
    manifest: "assets/AppIcon.icon/icon.json",
  },
  { name: "direct-child Xcode catalog", file: "OpenCode/Assets.xcassets/AppIcon.appiconset/icon128.svg" },
  { name: "Windows nearest usable size", file: "resources/windows/icon-96.png" },
  { name: "Scrawl oversized flat icon", file: "site/public/icon.svg" },
]) {
  it.live(`discovers ${fixture.name} without a database`, () =>
    Effect.gen(function* () {
      const tmp = yield* tmpdirScoped()
      const filesystem = yield* FSUtil.Service
      yield* Effect.promise(() =>
        Bun.write(
          path.join(tmp.path, fixture.file),
          fixture.file.endsWith(".png")
            ? Buffer.from(
                "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aWZkAAAAASUVORK5CYII=",
                "base64",
              )
            : svg,
        ),
      )
      if (fixture.manifest)
        yield* Effect.promise(() =>
          Bun.write(
            path.join(tmp.path, fixture.manifest),
            JSON.stringify({
              groups: [{ layers: [{ "image-name": path.basename(fixture.file) }] }],
            }),
          ),
        )
      if (fixture.name === "Windows nearest usable size") {
        yield* Effect.promise(() => Bun.write(path.join(tmp.path, "resources/windows/icon-128.png"), "x".repeat(65537)))
        yield* Effect.promise(() => Bun.write(path.join(tmp.path, "resources/windows/icon-32.png"), "other"))
      }
      if (fixture.name === "Scrawl oversized flat icon")
        yield* Effect.promise(() => Bun.write(path.join(tmp.path, "assets/app-icon.png"), "x".repeat(65537)))
      expect((yield* ProjectIcon.discover(filesystem, tmp.path))?.path.split(path.sep).join("/")).toBe(fixture.file)
    }),
  )
}

it.live("Composer backgrounds stay inert and malformed, oversized or escaping manifests fall through", () =>
  Effect.gen(function* () {
    const tmp = yield* tmpdirScoped()
    const filesystem = yield* FSUtil.Service
    const manifest = path.join(tmp.path, "AppIcon.icon/icon.json")
    yield* Effect.promise(() => Bun.write(path.join(tmp.path, "AppIcon.icon/Assets/logo.svg"), svg))
    for (const fill of [
      { solid: "display-p3:0.075,0.063,0.063,1" },
      { "linear-gradient": ["gray:0.2,1", "srgb:0,0,0,1"] },
    ]) {
      yield* Effect.promise(() =>
        Bun.write(manifest, JSON.stringify({ fill, groups: [{ layers: [{ "image-name": "logo.svg" }] }] })),
      )
      const icon = yield* ProjectIcon.discover(filesystem, tmp.path)
      if (!icon) throw new Error("Expected Composer icon")
      const markup = Buffer.from(icon.url.slice(icon.url.indexOf(",") + 1), "base64").toString()
      expect(markup).toContain(`<image width="128" height="128" href="${url}"`)
      expect(markup).toContain("<rect")
      expect(icon.url.length).toBeLessThanOrEqual(65536)
    }
    for (const content of [
      "{",
      "x".repeat(65537),
      JSON.stringify({ groups: [{ layers: [{ "image-name": "missing.svg" }] }] }),
    ]) {
      yield* Effect.promise(() => Bun.write(manifest, content))
      expect(yield* ProjectIcon.discover(filesystem, tmp.path)).toBeUndefined()
    }
    const outside = yield* tmpdirScoped()
    yield* Effect.promise(() =>
      Bun.write(
        path.join(outside.path, "icon.json"),
        JSON.stringify({ groups: [{ layers: [{ "image-name": "logo.svg" }] }] }),
      ),
    )
    yield* Effect.promise(() => fs.rm(manifest))
    yield* Effect.promise(() => fs.symlink(path.join(outside.path, "icon.json"), manifest))
    expect(yield* ProjectIcon.discover(filesystem, tmp.path)).toBeUndefined()
  }),
)
