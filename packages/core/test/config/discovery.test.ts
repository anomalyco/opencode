import path from "path"
import fs from "fs/promises"
import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { ConfigDiscovery } from "@opencode/core/config/discovery"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { Location } from "@opencode/core/location"
import { AbsolutePath } from "@opencode/core/schema"
import { FSUtil } from "@opencode/util/fs-util"
import { Global } from "@opencode/util/global"
import { location } from "../fixture/location"
import { tmpdir } from "../fixture/tmpdir"
import { testEffect } from "../lib/effect"

const it = testEffect(Layer.empty)

function inFixture(root: string, target: string) {
  const relative = path.relative(root, target)
  return relative === "" || (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
}

describe("ConfigDiscovery.discover", () => {
  it.live("skips resolve and stat calls for absent ancestor candidates while keeping watch paths", () =>
    Effect.acquireDisposable(Effect.promise(() => tmpdir())).pipe(
      Effect.flatMap((tmp) =>
        Effect.gen(function* () {
          const root = yield* Effect.promise(() => fs.realpath(tmp.path))
          const globalDir = path.join(root, "global")
          const ancestor = path.join(root, "ws", "org", "repo")
          const nested = path.join(ancestor, "packages", "feature")
          yield* Effect.promise(async () => {
            await fs.mkdir(path.join(ancestor, ".opencode"), { recursive: true })
            await fs.mkdir(nested, { recursive: true })
            await fs.writeFile(path.join(nested, "opencode.json"), "{}")
          })

          const resolved: string[] = []
          const dirChecks: string[] = []
          const countingFs = Layer.effect(
            FSUtil.Service,
            Effect.gen(function* () {
              const base = yield* FSUtil.Service
              return FSUtil.Service.of({
                ...base,
                resolve: (input) => {
                  resolved.push(input)
                  return base.resolve(input)
                },
                isDir: (input) => {
                  dirChecks.push(input)
                  return base.isDir(input)
                },
              })
            }),
          ).pipe(Layer.provide(AppNodeBuilder.build(FSUtil.node)))

          const layer = Layer.mergeAll(
            countingFs,
            Global.layerWith({ config: globalDir, home: path.join(globalDir, "home") }),
            Layer.succeed(
              Location.Service,
              Location.Service.of(
                location({ directory: AbsolutePath.make(nested) }, { projectDirectory: AbsolutePath.make(ancestor) }),
              ),
            ),
          )

          const sources = yield* ConfigDiscovery.discover({ system: false }).pipe(Effect.provide(layer))

          const fixtureResolved = resolved.filter((item) => inFixture(path.join(root, "ws"), item))
          expect(fixtureResolved).not.toContain(path.join(nested, "opencode.jsonc"))
          expect(fixtureResolved).not.toContain(path.join(nested, ".opencode"))
          expect(fixtureResolved).not.toContain(path.join(ancestor, "opencode.json"))
          expect(fixtureResolved).toContain(path.join(nested, "opencode.json"))
          expect(fixtureResolved).toContain(path.join(ancestor, ".opencode"))

          const fixtureDirChecks = dirChecks.filter((item) => inFixture(path.join(root, "ws"), item))
          expect(fixtureDirChecks).toEqual([path.join(ancestor, ".opencode")])

          const wsDirect = sources.direct.filter((item) => inFixture(path.join(root, "ws"), item))
          expect(wsDirect).toContain(AbsolutePath.make(path.join(nested, "opencode.jsonc")))
          expect(wsDirect).toContain(AbsolutePath.make(path.join(nested, "opencode.json")))
          expect(sources.project.filter((entry) => inFixture(path.join(root, "ws"), entry.path))).toContainEqual({
            path: AbsolutePath.make(path.join(ancestor, ".opencode")),
            present: true,
          })
          expect(sources.project.filter((entry) => inFixture(path.join(root, "ws"), entry.path))).toContainEqual({
            path: AbsolutePath.make(path.join(nested, ".opencode")),
            present: false,
          })
        }),
      ),
    ),
  )

  it.live("falls back to direct candidate probes when listing an ancestor directory is denied", () =>
    Effect.acquireDisposable(Effect.promise(() => tmpdir())).pipe(
      Effect.flatMap((tmp) =>
        Effect.gen(function* () {
          const root = yield* Effect.promise(() => fs.realpath(tmp.path))
          const globalDir = path.join(root, "global")
          const guarded = path.join(root, "guarded")
          const project = path.join(guarded, "project")
          yield* Effect.promise(async () => {
            await fs.mkdir(path.join(guarded, ".opencode"), { recursive: true })
            await fs.mkdir(project, { recursive: true })
          })

          const sandboxFs = Layer.effect(
            FSUtil.Service,
            Effect.gen(function* () {
              const base = yield* FSUtil.Service
              return FSUtil.Service.of({
                ...base,
                readDirectory: (target, options) =>
                  target === guarded
                    ? base.readDirectory(path.join(target, "unreadable-missing"), options)
                    : base.readDirectory(target, options),
              })
            }),
          ).pipe(Layer.provide(AppNodeBuilder.build(FSUtil.node)))

          const layer = Layer.mergeAll(
            sandboxFs,
            Global.layerWith({ config: globalDir, home: path.join(globalDir, "home") }),
            Layer.succeed(
              Location.Service,
              Location.Service.of(
                location({ directory: AbsolutePath.make(project) }, { projectDirectory: AbsolutePath.make(project) }),
              ),
            ),
          )

          const sources = yield* ConfigDiscovery.discover({ system: false }).pipe(Effect.provide(layer))
          expect(sources.project).toContainEqual({
            path: AbsolutePath.make(path.join(guarded, ".opencode")),
            present: true,
          })
        }),
      ),
    ),
  )

  it.live("probes candidates when readDirectory reports a differently cased entry", () =>
    Effect.acquireDisposable(Effect.promise(() => tmpdir())).pipe(
      Effect.flatMap((tmp) =>
        Effect.gen(function* () {
          const root = yield* Effect.promise(() => fs.realpath(tmp.path))
          const globalDir = path.join(root, "global")
          const project = path.join(root, "cased")
          yield* Effect.promise(async () => {
            await fs.mkdir(path.join(project, ".opencode"), { recursive: true })
          })

          const casedFs = Layer.effect(
            FSUtil.Service,
            Effect.gen(function* () {
              const base = yield* FSUtil.Service
              return FSUtil.Service.of({
                ...base,
                readDirectory: (target, options) =>
                  target === project ? Effect.succeed([".OPENCODE"]) : base.readDirectory(target, options),
              })
            }),
          ).pipe(Layer.provide(AppNodeBuilder.build(FSUtil.node)))

          const layer = Layer.mergeAll(
            casedFs,
            Global.layerWith({ config: globalDir, home: path.join(globalDir, "home") }),
            Layer.succeed(
              Location.Service,
              Location.Service.of(
                location({ directory: AbsolutePath.make(project) }, { projectDirectory: AbsolutePath.make(project) }),
              ),
            ),
          )

          const sources = yield* ConfigDiscovery.discover({ system: false }).pipe(Effect.provide(layer))
          expect(sources.project).toContainEqual({
            path: AbsolutePath.make(path.join(project, ".opencode")),
            present: true,
          })
        }),
      ),
    ),
  )
})
