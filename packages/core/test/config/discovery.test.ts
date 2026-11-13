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

function discoverWith(
  root: string,
  directory: string,
  projectDirectory = directory,
  wrapFs?: (base: FSUtil.Interface) => Partial<FSUtil.Interface>,
  configDirs?: readonly string[],
) {
  const globalDir = path.join(root, "global")
  const fsLayer = wrapFs
    ? Layer.effect(
        FSUtil.Service,
        Effect.map(FSUtil.Service, (base) => FSUtil.Service.of({ ...base, ...wrapFs(base) })),
      ).pipe(Layer.provide(AppNodeBuilder.build(FSUtil.node)))
    : AppNodeBuilder.build(FSUtil.node)

  return ConfigDiscovery.discover({ system: false }).pipe(
    Effect.provide(
      Layer.mergeAll(
        fsLayer,
        Global.layerWith({
          config: globalDir,
          home: path.join(globalDir, "home"),
          ...(configDirs ? { configDirs } : {}),
        }),
        Layer.succeed(
          Location.Service,
          Location.Service.of(
            location(
              { directory: AbsolutePath.make(directory) },
              { projectDirectory: AbsolutePath.make(projectDirectory) },
            ),
          ),
        ),
      ),
    ),
  )
}

describe("ConfigDiscovery.discover", () => {
  it.live("skips resolve and stat calls for absent ancestor candidates while keeping watch paths", () =>
    Effect.acquireDisposable(Effect.promise(() => tmpdir())).pipe(
      Effect.flatMap((tmp) =>
        Effect.gen(function* () {
          const root = yield* Effect.promise(() => fs.realpath(tmp.path))
          const ancestor = path.join(root, "ws", "org", "repo")
          const nested = path.join(ancestor, "packages", "feature")
          yield* Effect.promise(async () => {
            await fs.mkdir(path.join(ancestor, ".opencode"), { recursive: true })
            await fs.mkdir(nested, { recursive: true })
            await fs.writeFile(path.join(nested, "opencode.json"), "{}")
          })

          const resolved: string[] = []
          const dirChecks: string[] = []
          const sources = yield* discoverWith(root, nested, ancestor, (base) => ({
            resolve: (input) => {
              resolved.push(input)
              return base.resolve(input)
            },
            isDir: (input) => {
              dirChecks.push(input)
              return base.isDir(input)
            },
          }))

          const ws = path.join(root, "ws")
          const fixtureResolved = resolved.filter((item) => inFixture(ws, item))
          expect(fixtureResolved).not.toContain(path.join(nested, "opencode.jsonc"))
          expect(fixtureResolved).not.toContain(path.join(nested, ".opencode"))
          expect(fixtureResolved).not.toContain(path.join(ancestor, "opencode.json"))
          expect(fixtureResolved).toContain(path.join(nested, "opencode.json"))
          expect(fixtureResolved).toContain(path.join(ancestor, ".opencode"))

          expect(dirChecks.filter((item) => inFixture(ws, item))).toEqual([path.join(ancestor, ".opencode")])

          const wsDirect = sources.direct.filter((item) => inFixture(ws, item))
          expect(wsDirect).toContain(AbsolutePath.make(path.join(nested, "opencode.jsonc")))
          expect(wsDirect).toContain(AbsolutePath.make(path.join(nested, "opencode.json")))
          const wsProject = sources.project.filter((entry) => inFixture(ws, entry.path))
          expect(wsProject).toContainEqual({ path: AbsolutePath.make(path.join(ancestor, ".opencode")), present: true })
          expect(wsProject).toContainEqual({ path: AbsolutePath.make(path.join(nested, ".opencode")), present: false })
        }),
      ),
    ),
  )

  it.live("falls back to direct candidate probes when listing an ancestor directory is denied", () =>
    Effect.acquireDisposable(Effect.promise(() => tmpdir())).pipe(
      Effect.flatMap((tmp) =>
        Effect.gen(function* () {
          const root = yield* Effect.promise(() => fs.realpath(tmp.path))
          const guarded = path.join(root, "guarded")
          const project = path.join(guarded, "project")
          yield* Effect.promise(async () => {
            await fs.mkdir(path.join(guarded, ".opencode"), { recursive: true })
            await fs.mkdir(project, { recursive: true })
          })

          const sources = yield* discoverWith(root, project, project, (base) => ({
            readDirectory: (target, options) =>
              target === guarded
                ? base.readDirectory(path.join(target, "unreadable-missing"), options)
                : base.readDirectory(target, options),
          }))
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
          const project = path.join(root, "cased")
          yield* Effect.promise(() => fs.mkdir(path.join(project, ".opencode"), { recursive: true }))

          const sources = yield* discoverWith(root, project, project, (base) => ({
            readDirectory: (target, options) =>
              target === project ? Effect.succeed([".OPENCODE"]) : base.readDirectory(target, options),
          }))
          expect(sources.project).toContainEqual({
            path: AbsolutePath.make(path.join(project, ".opencode")),
            present: true,
          })
        }),
      ),
    ),
  )

  it.live("reports every global config directory with the primary first and none when global is disabled", () =>
    Effect.acquireDisposable(Effect.promise(() => tmpdir())).pipe(
      Effect.flatMap((tmp) =>
        Effect.gen(function* () {
          const root = yield* Effect.promise(() => fs.realpath(tmp.path))
          const project = path.join(root, "repo")
          yield* Effect.promise(() => fs.mkdir(project, { recursive: true }))
          const primary = path.join(root, "global")
          const extra = path.join(root, "xdg-config", "opencode")

          // OPENCODE_CONFIG_DIR adds a second global directory; the override (primary) leads.
          const sources = yield* discoverWith(root, project, project, undefined, [primary, extra])
          expect(sources.global).toBe(AbsolutePath.make(primary))
          expect(sources.globalDirs).toEqual([AbsolutePath.make(primary), AbsolutePath.make(extra)])

          // Without an override the global layer stays a single directory.
          const single = yield* discoverWith(root, project, project)
          expect(single.global).toBe(AbsolutePath.make(primary))
          expect(single.globalDirs).toEqual([AbsolutePath.make(primary)])

          const disabled = yield* ConfigDiscovery.discover({ system: false, global: false }).pipe(
            Effect.provide(
              Layer.mergeAll(
                AppNodeBuilder.build(FSUtil.node),
                Global.layerWith({ config: primary, home: path.join(primary, "home"), configDirs: [primary, extra] }),
                Layer.succeed(
                  Location.Service,
                  Location.Service.of(
                    location(
                      { directory: AbsolutePath.make(project) },
                      { projectDirectory: AbsolutePath.make(project) },
                    ),
                  ),
                ),
              ),
            ),
          )
          expect(disabled.global).toBeUndefined()
          expect(disabled.globalDirs).toEqual([])
        }),
      ),
    ),
  )
})
