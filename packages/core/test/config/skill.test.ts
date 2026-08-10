import fs from "fs/promises"
import path from "path"
import { describe, expect } from "bun:test"
import { Deferred, Effect, Fiber, Layer, Schema, Stream } from "effect"
import { Config } from "@opencode-ai/core/config"
import { Document, Info } from "@opencode-ai/schema/config"
import { ConfigSkillPlugin } from "@opencode-ai/core/config/plugin/skill"
import { SkillFile } from "@opencode-ai/core/config/plugin/skill-file"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { Watcher } from "@opencode-ai/core/filesystem/watcher"
import { Bus } from "@opencode-ai/core/bus"
import { FSUtil } from "@opencode-ai/util/fs-util"
import { Global } from "@opencode-ai/util/global"
import { LayerNode } from "@opencode-ai/util/effect/layer-node"
import { Location } from "@opencode-ai/core/location"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { Skill } from "@opencode-ai/core/skill"
import { SkillDiscovery } from "@opencode-ai/core/skill/discovery"
import { tmpdir } from "../fixture/tmpdir"
import { location } from "../fixture/location"
import { testEffect } from "../lib/effect"
import { host } from "../plugin/host"

const urls = new Map<string, AbsolutePath[]>()
let pulls = 0
const discoveryLayer = Layer.succeed(
  SkillDiscovery.Service,
  SkillDiscovery.Service.of({
    pull: (url) => {
      pulls++
      return Effect.succeed(urls.get(url) ?? [])
    },
  }),
)
const watcherLayer = Watcher.testLayer
const it = testEffect(
  Layer.mergeAll(
    AppNodeBuilder.build(LayerNode.group([Skill.node, Bus.node, FSUtil.node])),
    discoveryLayer,
    watcherLayer,
  ),
)
const decode = Schema.decodeUnknownSync(Info)

function write(directory: string, name: string, description: string) {
  return fs.writeFile(
    path.join(directory, name, "SKILL.md"),
    `---
name: ${name}
description: ${description}
---
# ${name}`,
  )
}

const configure = (skills: string[]) =>
  Config.testLayer([
    new Document({
      type: "document",
      info: decode({ skills }),
    }),
  ])

const start = Effect.fnUntraced(function* (skills: string[], directory: string) {
  const service = yield* Skill.Service
  yield* ConfigSkillPlugin.Plugin.effect(
    host({
      skill: {
        list: () => Effect.die("unused skill.list"),
        transform: service.transform,
        reload: service.reload,
      },
    }),
  ).pipe(
    Effect.provide(configure(skills)),
    Effect.provideService(Global.Service, Global.Service.of({ ...Global.make(), home: directory })),
    Effect.provideService(Location.Service, Location.Service.of(location({ directory: AbsolutePath.make(directory) }))),
  )
  return service
})

function emitAndWait(update: Watcher.Update) {
  return Effect.gen(function* () {
    const watcher = yield* Watcher.Test
    const bus = yield* Bus.Service
    const deferred = yield* Deferred.make<void>()
    const fiber = yield* bus.subscribe(Skill.Event.Updated).pipe(
      Stream.runForEach(() => Deferred.succeed(deferred, undefined).pipe(Effect.asVoid)),
      Effect.forkScoped,
    )
    yield* Effect.yieldNow
    yield* watcher.emit(update)
    yield* Deferred.await(deferred).pipe(Effect.timeout("2 seconds"))
    yield* Fiber.interrupt(fiber)
  })
}

describe("SkillFile.parse", () => {
  it.effect("parses root and nested skill ids and metadata flags", () =>
    Effect.sync(() => {
      const directory = "/repo/skills"
      expect(
        SkillFile.parse(
          directory,
          "/repo/skills/manual/SKILL.md",
          `---
name: Manual
description: Manual only
metadata:
  opencode/slash: "true"
  opencode/autoinvoke: false
---
# manual`,
        ),
      ).toEqual({
        id: Skill.ID.make("manual"),
        name: Skill.Name.make("Manual"),
        description: "Manual only",
        slash: true,
        autoinvoke: false,
        location: AbsolutePath.make("/repo/skills/manual/SKILL.md"),
        content: "# manual",
      })
      expect(SkillFile.parse(directory, "/repo/skills/foo.md", "---\nslash: true\n---\n# foo")?.id).toBe(
        Skill.ID.make("foo"),
      )
    }),
  )
})

describe("ConfigSkillPlugin.Plugin", () => {
  it.live("loads directory and URL sources with later-source precedence", () =>
    Effect.acquireRelease(
      Effect.promise(() => tmpdir()),
      (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
    ).pipe(
      Effect.flatMap((tmp) =>
        Effect.gen(function* () {
          const first = path.join(tmp.path, "first")
          const second = path.join(tmp.path, "second")
          yield* Effect.promise(async () => {
            await fs.mkdir(path.join(first, "review"), { recursive: true })
            await fs.mkdir(path.join(second, "review"), { recursive: true })
            await write(first, "review", "First")
            await write(second, "review", "Second")
          })
          pulls = 0
          urls.set("https://example.test/skills/", [AbsolutePath.make(second)])

          const skill = yield* start([first, "https://example.test/skills/"], tmp.path)
          expect((yield* skill.list()).find((item) => item.id === "review")?.description).toBe("Second")
          expect(pulls).toBe(1)
        }),
      ),
    ),
  )

  it.live("rescans directory sources when watched files change", () =>
    Effect.acquireRelease(
      Effect.promise(() => tmpdir()),
      (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
    ).pipe(
      Effect.flatMap((tmp) =>
        Effect.gen(function* () {
          yield* Effect.promise(async () => {
            await fs.mkdir(path.join(tmp.path, "deploy"), { recursive: true })
            await write(tmp.path, "deploy", "Initial")
          })
          const skill = yield* start([tmp.path], tmp.path)
          expect((yield* skill.list()).find((item) => item.id === "deploy")?.description).toBe("Initial")

          const deploy = path.join(tmp.path, "deploy", "SKILL.md")
          yield* Effect.promise(() => write(tmp.path, "deploy", "Updated"))
          yield* emitAndWait({ type: "update", path: deploy })
          expect((yield* skill.list()).find((item) => item.id === "deploy")?.description).toBe("Updated")

          yield* Effect.promise(async () => {
            await fs.mkdir(path.join(tmp.path, "review"), { recursive: true })
            await write(tmp.path, "review", "Review")
          })
          yield* emitAndWait({ type: "create", path: path.join(tmp.path, "review", "SKILL.md") })
          expect((yield* skill.list()).map((item) => item.id)).toEqual([
            Skill.ID.make("deploy"),
            Skill.ID.make("review"),
          ])
        }),
      ),
    ),
  )

  it.live("follows missing source directories as their parents appear", () =>
    Effect.acquireRelease(
      Effect.promise(() => tmpdir()),
      (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
    ).pipe(
      Effect.flatMap((tmp) =>
        Effect.gen(function* () {
          const source = path.join(tmp.path, "generated", "skills")
          const skill = yield* start([source], tmp.path)
          const watcher = yield* Watcher.Test
          expect(yield* skill.list()).toEqual([])
          expect(yield* watcher.subscriptions()).toEqual([{ path: path.join(tmp.path, "generated"), type: "file" }])

          yield* Effect.promise(() => fs.mkdir(path.join(tmp.path, "generated")))
          yield* emitAndWait({ type: "create", path: path.join(tmp.path, "generated") })
          yield* Effect.promise(async () => {
            await fs.mkdir(path.join(source, "deploy"), { recursive: true })
            await write(source, "deploy", "Deploy")
          })
          yield* emitAndWait({ type: "create", path: source })
          expect((yield* skill.list()).map((item) => item.id)).toEqual([Skill.ID.make("deploy")])
        }),
      ),
    ),
  )
})
