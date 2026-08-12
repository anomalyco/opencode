import { describe, expect } from "bun:test"
import { Deferred, Effect, Fiber, Layer, Stream } from "effect"
import fs from "fs/promises"
import path from "path"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { Bus } from "@opencode-ai/core/bus"
import { ConfigInstructionPlugin } from "@opencode-ai/core/config/plugin/instruction"
import { Watcher } from "@opencode-ai/core/filesystem/watcher"
import { InstructionDiscovery } from "@opencode-ai/core/instruction-discovery"
import { Instructions } from "@opencode-ai/core/instructions"
import { Location } from "@opencode-ai/core/location"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { FSUtil } from "@opencode-ai/util/fs-util"
import { Global } from "@opencode-ai/util/global"
import { LayerNode } from "@opencode-ai/util/effect/layer-node"
import { tempGlobalLayer } from "./fixture/global"
import { location } from "./fixture/location"
import { tmpdir } from "./fixture/tmpdir"
import { readInitial, readUpdate, state } from "./lib/instructions"
import { testEffect } from "./lib/effect"
import { host } from "./plugin/host"

const it = testEffect(Layer.empty)

const instructionLayer = (input: {
  config?: string
  home?: string
  locationServiceLayer: Layer.Layer<Location.Service>
  filesystemLayer?: Layer.Layer<FSUtil.Service>
  project?: boolean
}) => {
  const watcher = Watcher.testLayer
  return Layer.mergeAll(
    AppNodeBuilder.build(
      LayerNode.group([InstructionDiscovery.node, Bus.node, FSUtil.node, Global.node, Location.node, Watcher.node]),
      [
        [InstructionDiscovery.node, InstructionDiscovery.configured({ project: input.project })],
        [
          Global.node,
          input.config || input.home
            ? Global.layerWith({
                ...(input.config ? { config: input.config } : {}),
                ...(input.home ? { home: input.home } : {}),
              })
            : tempGlobalLayer,
        ],
        [Location.node, input.locationServiceLayer],
        [Watcher.node, watcher],
        ...(input.filesystemLayer ? [[FSUtil.node, input.filesystemLayer] as const] : []),
      ],
    ),
    watcher,
  )
}

const start = Effect.fnUntraced(function* () {
  yield* ConfigInstructionPlugin.Plugin.effect(host())
  return yield* InstructionDiscovery.Service
})

const file = (path: string, content: string) =>
  new InstructionDiscovery.File({ path: AbsolutePath.make(path), content })

function emitAndWait(update: Watcher.Update) {
  return Effect.gen(function* () {
    const watcher = yield* Watcher.Test
    const bus = yield* Bus.Service
    const updated = yield* Deferred.make<void>()
    const fiber = yield* bus.subscribe(InstructionDiscovery.Event.Updated).pipe(
      Stream.runForEach(() => Deferred.succeed(updated, undefined).pipe(Effect.asVoid)),
      Effect.forkScoped,
    )
    yield* Effect.yieldNow
    yield* watcher.emit(update)
    yield* Deferred.await(updated).pipe(Effect.timeout("2 seconds"))
    yield* Fiber.interrupt(fiber)
  })
}

describe("InstructionDiscovery", () => {
  it.effect("stores ordered values with last-write-wins precedence", () =>
    Effect.gen(function* () {
      const discovery = yield* InstructionDiscovery.Service
      yield* discovery.transform((draft) => {
        draft.add(file("/repo/AGENTS.md", "first"))
        draft.add(file("/repo/packages/AGENTS.md", "package"))
        draft.add(file("/repo/AGENTS.md", "last"))
        draft.update("/repo/packages/AGENTS.md", (current) => {
          current.content = "updated"
          current.path = AbsolutePath.make("/ignored")
        })
        draft.remove("/missing")
      })

      expect(yield* discovery.list()).toEqual([
        file("/repo/AGENTS.md", "last"),
        file("/repo/packages/AGENTS.md", "updated"),
      ])
    }).pipe(Effect.provide(AppNodeBuilder.build(LayerNode.group([InstructionDiscovery.node, Bus.node])))),
  )

  it.effect("preserves admitted values while the source is unavailable", () =>
    Effect.gen(function* () {
      const discovery = yield* InstructionDiscovery.Service
      yield* discovery.transform((draft) => draft.unavailable())
      expect(
        (yield* readUpdate(
          yield* discovery.load(),
          state({ "core/instructions": [{ path: "/repo/AGENTS.md", content: "old" }] }),
        )).changed,
      ).toBe(false)
    }).pipe(Effect.provide(AppNodeBuilder.build(LayerNode.group([InstructionDiscovery.node, Bus.node])))),
  )
})

describe("ConfigInstructionPlugin.Plugin", () => {
  it.live("loads global and upward project files and rescans them on change", () =>
    Effect.acquireRelease(
      Effect.promise(() => tmpdir()),
      (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
    ).pipe(
      Effect.flatMap((tmp) => {
        const global = path.join(tmp.path, "global")
        const home = path.join(tmp.path, "home")
        const shared = path.join(home, "code")
        const project = path.join(shared, "repo")
        const directory = path.join(project, "packages", "core")
        const outside = path.join(tmp.path, "AGENTS.md")
        const globalFile = path.join(global, "AGENTS.md")
        const sharedFile = path.join(shared, "AGENTS.md")
        const projectFile = path.join(project, "AGENTS.md")
        const packageFile = path.join(directory, "AGENTS.md")
        return Effect.gen(function* () {
          yield* Effect.promise(async () => {
            await fs.mkdir(global, { recursive: true })
            await fs.mkdir(directory, { recursive: true })
            await fs.writeFile(outside, "outside")
            await fs.writeFile(globalFile, "global")
            await fs.writeFile(sharedFile, "shared")
            await fs.writeFile(projectFile, "project")
            await fs.writeFile(packageFile, "package")
          })

          const discovery = yield* start()
          const watcher = yield* Watcher.Test
          expect(yield* watcher.subscriptions()).toEqual([
            { path: globalFile, type: "file" },
            { path: packageFile, type: "file" },
            { path: path.join(project, "packages", "AGENTS.md"), type: "file" },
            { path: projectFile, type: "file" },
            { path: sharedFile, type: "file" },
            { path: path.join(home, "AGENTS.md"), type: "file" },
          ])
          expect(yield* watcher.subscriptions()).not.toContainEqual({
            path: path.join(tmp.path, "AGENTS.md"),
            type: "file",
          })
          const initialized = yield* readInitial(yield* discovery.load())
          expect(initialized.text).toBe(
            [
              `Instructions from: ${globalFile}\nglobal`,
              `Instructions from: ${packageFile}\npackage`,
              `Instructions from: ${projectFile}\nproject`,
              `Instructions from: ${sharedFile}\nshared`,
            ].join("\n\n"),
          )
          expect(initialized.text).not.toContain("outside")

          yield* Effect.promise(() => fs.writeFile(packageFile, "changed"))
          yield* emitAndWait({ type: "update", path: packageFile })
          expect((yield* readUpdate(yield* discovery.load(), initialized)).text).toContain(
            `Instructions from: ${packageFile}\nchanged`,
          )

          yield* Effect.promise(() => fs.rm(packageFile))
          yield* emitAndWait({ type: "delete", path: packageFile })
          expect((yield* readUpdate(yield* discovery.load(), initialized)).text).toBe(
            [
              "These instructions replace all previously loaded ambient instructions.",
              `Instructions from: ${globalFile}\nglobal`,
              `Instructions from: ${projectFile}\nproject`,
              `Instructions from: ${sharedFile}\nshared`,
            ].join("\n\n"),
          )

          yield* Effect.promise(() => fs.rm(globalFile))
          yield* emitAndWait({ type: "delete", path: globalFile })
          yield* Effect.promise(() => fs.rm(projectFile))
          yield* emitAndWait({ type: "delete", path: projectFile })
          yield* Effect.promise(() => fs.rm(sharedFile))
          yield* emitAndWait({ type: "delete", path: sharedFile })
          expect((yield* readUpdate(yield* discovery.load(), initialized)).text).toBe(
            "Previously loaded instructions no longer apply.",
          )
        }).pipe(
          Effect.provide(
            instructionLayer({
              config: global,
              home,
              locationServiceLayer: Layer.succeed(
                Location.Service,
                Location.Service.of(
                  location(
                    { directory: AbsolutePath.make(directory) },
                    { projectDirectory: AbsolutePath.make(project) },
                  ),
                ),
              ),
            }),
          ),
        )
      }),
    ),
  )

  it.live("keeps an empty AGENTS.md as available context", () =>
    Effect.acquireRelease(
      Effect.promise(() => tmpdir()),
      (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
    ).pipe(
      Effect.flatMap((tmp) =>
        Effect.gen(function* () {
          const file = path.join(tmp.path, "AGENTS.md")
          yield* Effect.promise(() => fs.writeFile(file, ""))
          const discovery = yield* start()
          expect((yield* readInitial(yield* discovery.load())).text).toBe(`Instructions from: ${file}\n`)
        }).pipe(
          Effect.provide(
            instructionLayer({
              config: path.join(tmp.path, "global"),
              locationServiceLayer: Layer.succeed(
                Location.Service,
                Location.Service.of(location({ directory: AbsolutePath.make(tmp.path) })),
              ),
            }),
          ),
        ),
      ),
    ),
  )

  it.live("discovers a newly created instruction file above the project root", () =>
    Effect.acquireRelease(
      Effect.promise(() => tmpdir()),
      (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
    ).pipe(
      Effect.flatMap((tmp) => {
        const home = path.join(tmp.path, "home")
        const shared = path.join(home, "code")
        const project = path.join(shared, "repo")
        const intermediate = path.join(shared, "AGENTS.md")
        const directory = path.join(project, "core")
        const projectFile = path.join(project, "AGENTS.md")
        return Effect.gen(function* () {
          yield* Effect.promise(() => fs.mkdir(directory, { recursive: true }))
          yield* Effect.promise(() => fs.writeFile(projectFile, "project"))
          const discovery = yield* start()
          expect((yield* readInitial(yield* discovery.load())).text).toBe(`Instructions from: ${projectFile}\nproject`)

          yield* Effect.promise(() => fs.writeFile(intermediate, "intermediate"))
          yield* emitAndWait({ type: "create", path: intermediate })

          expect((yield* readInitial(yield* discovery.load())).text).toBe(
            [`Instructions from: ${projectFile}\nproject`, `Instructions from: ${intermediate}\nintermediate`].join(
              "\n\n",
            ),
          )
        }).pipe(
          Effect.provide(
            instructionLayer({
              config: path.join(tmp.path, "global"),
              home,
              locationServiceLayer: Layer.succeed(
                Location.Service,
                Location.Service.of(
                  location(
                    { directory: AbsolutePath.make(directory) },
                    { projectDirectory: AbsolutePath.make(project) },
                  ),
                ),
              ),
            }),
          ),
        )
      }),
    ),
  )

  it.live("stops instruction candidates at the project root outside home", () =>
    Effect.acquireRelease(
      Effect.promise(() => tmpdir()),
      (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
    ).pipe(
      Effect.flatMap((tmp) => {
        const global = path.join(tmp.path, "global")
        const home = path.join(tmp.path, "home")
        const project = path.join(tmp.path, "scratch", "repo")
        const directory = path.join(project, "packages", "core")
        return Effect.gen(function* () {
          yield* Effect.promise(() => fs.mkdir(directory, { recursive: true }))
          yield* start()
          const watcher = yield* Watcher.Test
          expect(yield* watcher.subscriptions()).toEqual([
            { path: path.join(global, "AGENTS.md"), type: "file" },
            { path: path.join(directory, "AGENTS.md"), type: "file" },
            { path: path.join(project, "packages", "AGENTS.md"), type: "file" },
            { path: path.join(project, "AGENTS.md"), type: "file" },
          ])
        }).pipe(
          Effect.provide(
            instructionLayer({
              config: global,
              home,
              locationServiceLayer: Layer.succeed(
                Location.Service,
                Location.Service.of(
                  location(
                    { directory: AbsolutePath.make(directory) },
                    { projectDirectory: AbsolutePath.make(project) },
                  ),
                ),
              ),
            }),
          ),
        )
      }),
    ),
  )

  it.effect("isolates source failure without failing activation", () => {
    const failingFS = Layer.effect(
      FSUtil.Service,
      FSUtil.Service.pipe(
        Effect.map((fs) =>
          FSUtil.Service.of({ ...fs, up: () => Effect.fail(new FSUtil.FileSystemError({ method: "up" })) }),
        ),
      ),
    ).pipe(Layer.provide(LayerNode.compile(FSUtil.node)))
    return Effect.gen(function* () {
      const discovery = yield* start()
      expect(
        (yield* readUpdate(
          yield* discovery.load(),
          state({ "core/instructions": [{ path: "/repo/AGENTS.md", content: "old" }] }),
        )).changed,
      ).toBe(false)
    }).pipe(
      Effect.provide(
        instructionLayer({
          filesystemLayer: failingFS,
          locationServiceLayer: Layer.succeed(
            Location.Service,
            Location.Service.of(location({ directory: AbsolutePath.make("/repo") })),
          ),
        }),
      ),
    )
  })

  it.effect("marks a discovered file that disappears before read as unavailable", () => {
    const discovered = AbsolutePath.make("/repo/AGENTS.md")
    const racingFS = Layer.effect(
      FSUtil.Service,
      FSUtil.Service.pipe(
        Effect.map((fs) =>
          FSUtil.Service.of({
            ...fs,
            up: () => Effect.succeed([discovered]),
            readFileStringSafe: () => Effect.succeed(undefined),
          }),
        ),
      ),
    ).pipe(Layer.provide(LayerNode.compile(FSUtil.node)))
    return Effect.gen(function* () {
      const discovery = yield* start()
      expect(
        (yield* readUpdate(
          yield* discovery.load(),
          state({ "core/instructions": [{ path: discovered, content: "old" }] }),
        )).changed,
      ).toBe(false)
    }).pipe(
      Effect.provide(
        instructionLayer({
          filesystemLayer: racingFS,
          locationServiceLayer: Layer.succeed(
            Location.Service,
            Location.Service.of(location({ directory: AbsolutePath.make("/repo") })),
          ),
        }),
      ),
    )
  })

  it.effect("canonicalizes boundaries and honors project opt-out", () =>
    Effect.gen(function* () {
      const observed: { values: { targets: string[]; start: string; stop?: string }[] } = { values: [] }
      const observingFS = Layer.effect(
        FSUtil.Service,
        FSUtil.Service.pipe(
          Effect.map((fs) =>
            FSUtil.Service.of({
              ...fs,
              up: (options) => Effect.sync(() => (observed.values.push(options), [])),
            }),
          ),
        ),
      ).pipe(Layer.provide(LayerNode.compile(FSUtil.node)))

      yield* start().pipe(
        Effect.provide(
          instructionLayer({
            filesystemLayer: observingFS,
            locationServiceLayer: Layer.succeed(
              Location.Service,
              Location.Service.of(
                location({ directory: AbsolutePath.make("/repo/") }, { projectDirectory: AbsolutePath.make("/repo") }),
              ),
            ),
          }),
        ),
      )
      yield* start().pipe(
        Effect.provide(
          instructionLayer({
            filesystemLayer: observingFS,
            project: false,
            locationServiceLayer: Layer.succeed(
              Location.Service,
              Location.Service.of(location({ directory: AbsolutePath.make("/repo") })),
            ),
          }),
        ),
      )
      yield* start().pipe(
        Effect.provide(
          instructionLayer({
            filesystemLayer: observingFS,
            locationServiceLayer: Layer.succeed(
              Location.Service,
              Location.Service.of(
                location(
                  { directory: AbsolutePath.make("/outside") },
                  { projectDirectory: AbsolutePath.make("/repo") },
                ),
              ),
            ),
          }),
        ),
      )

      const repo = path.resolve("/repo")
      expect(observed.values).toEqual([{ targets: ["AGENTS.md"], start: repo, stop: repo }])
    }),
  )
})
