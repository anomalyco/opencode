import fs from "fs/promises"
import path from "path"
import { describe, expect, test } from "bun:test"
import { Deferred, Effect, Fiber, Layer, PubSub, Ref, Schema, Stream } from "effect"
import { Config } from "@opencode-ai/core/config"
import { AgentsDirectory, ClaudeDirectory, Directory, Document, type Entry, Info } from "@opencode-ai/schema/config"
import { Event } from "@opencode-ai/schema/event"
import { ConfigSkillPlugin } from "@opencode-ai/core/config/plugin/skill"
import { SkillFile } from "@opencode-ai/core/config/plugin/skill-file"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { Watcher } from "@opencode-ai/core/filesystem/watcher"
import { Bus } from "@opencode-ai/core/bus"
import { Credential } from "@opencode-ai/core/credential"
import { FSUtil } from "@opencode-ai/util/fs-util"
import { Global } from "@opencode-ai/util/global"
import { LayerNode } from "@opencode-ai/util/effect/layer-node"
import { Location } from "@opencode-ai/core/location"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { Skill } from "@opencode-ai/core/skill"
import { SkillDiscovery } from "@opencode-ai/core/skill/discovery"
import { WellKnown } from "@opencode-ai/core/wellknown"
import { emptyCredentialNode, emptyWellknownNode } from "../fixture/config-nodes"
import { tmpdir } from "../fixture/tmpdir"
import { location } from "../fixture/location"
import { testEffect } from "../lib/effect"
import { host } from "../plugin/host"

const emptyDiscovery = SkillDiscovery.Service.of({ pull: () => Effect.succeed([]) })
const watcherLayer = Watcher.testLayer
const it = testEffect(
  Layer.merge(AppNodeBuilder.build(LayerNode.group([Skill.node, Bus.node, FSUtil.node])), watcherLayer),
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

const startEntries = Effect.fnUntraced(function* (
  entries: Entry[],
  directory: string,
  home = directory,
  discovery = emptyDiscovery,
) {
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
    Effect.provide(Config.testLayer(entries)),
    Effect.provideService(SkillDiscovery.Service, discovery),
    Effect.provideService(Global.Service, Global.Service.of({ ...Global.make(), home })),
    Effect.provideService(Location.Service, Location.Service.of(location({ directory: AbsolutePath.make(directory) }))),
  )
  return service
})

const start = (skills: string[], directory: string, discovery = emptyDiscovery) =>
  startEntries(
    [
      new Document({
        type: "document",
        info: decode({ skills }),
      }),
    ],
    directory,
    directory,
    discovery,
  )

const discover = (directory: string, global: string) =>
  Effect.gen(function* () {
    const config = yield* Config.Service
    return yield* config.entries()
  }).pipe(
    Effect.provide(
      AppNodeBuilder.build(LayerNode.group([Config.node, Bus.node]), [
        Location.node.replace(
          Layer.succeed(Location.Service, Location.Service.of(location({ directory: AbsolutePath.make(directory) }))),
        ),
        Global.node.replace(Global.layerWith({ config: global, home: path.join(global, "home") })),
        Credential.node.replace(emptyCredentialNode),
        WellKnown.node.replace(emptyWellknownNode),
        Watcher.node.replace(Watcher.testLayer),
      ]),
    ),
  )

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
  test("parses root and nested skill ids and metadata flags", () => {
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
      _tag: "Parsed",
      skill: {
        id: Skill.ID.make("manual"),
        name: Skill.Name.make("Manual"),
        description: "Manual only",
        slash: true,
        autoinvoke: false,
        location: AbsolutePath.make("/repo/skills/manual/SKILL.md"),
        content: "# manual",
      },
    })
    expect(SkillFile.parse(directory, "/repo/skills/foo.md", "---\nslash: true\n---\n# foo")).toMatchObject({
      _tag: "Parsed",
      skill: { id: Skill.ID.make("foo") },
    })
    expect(SkillFile.parse("/repo/skills/manual", "/repo/skills/manual/SKILL.md", "# manual")).toMatchObject({
      _tag: "Parsed",
      skill: { id: Skill.ID.make("manual"), name: Skill.Name.make("manual") },
    })
    expect(
      SkillFile.parse(directory, "/repo/skills/broken.md", "---\ndescription: foo: bar\nmetadata: [\n---\n# broken"),
    ).toEqual({ _tag: "Skipped", reason: "markdown" })
    expect(SkillFile.parse(directory, "/repo/skills/broken.md", "---\nslash: nope\n---\n# broken")).toMatchObject({
      _tag: "Skipped",
      reason: "frontmatter",
      issue: expect.anything(),
    })
  })
})

describe("ConfigSkillPlugin.Plugin", () => {
  it.live("retains a config update received during initial skill loading", () =>
    Effect.acquireDisposable(Effect.promise(() => tmpdir())).pipe(
      Effect.flatMap((tmp) =>
        Effect.gen(function* () {
          yield* Effect.promise(async () => {
            await fs.mkdir(path.join(tmp.path, "latest"), { recursive: true })
            await write(tmp.path, "latest", "Latest configuration")
          })
          const current = yield* Ref.make<Entry[]>([
            new Document({ type: "document", info: decode({ skills: ["https://example.test/skills/"] }) }),
          ])
          const events = yield* PubSub.unbounded<{
            id: Event.ID
            created: number
            type: "config.updated"
            data: {}
          }>()
          const loading = yield* Deferred.make<void>()
          const release = yield* Deferred.make<void>()
          const reloaded = yield* Deferred.make<void>()
          const skill = yield* Skill.Service
          const startup = yield* ConfigSkillPlugin.Plugin.effect(
            host({
              event: { subscribe: () => Stream.fromPubSub(events) },
              skill: {
                list: () => Effect.die("unused skill.list"),
                transform: skill.transform,
                reload: () => skill.reload().pipe(Effect.andThen(Deferred.succeed(reloaded, undefined))),
              },
            }),
          ).pipe(
            Effect.provideService(
              Config.Service,
              Config.Service.of({
                entries: () => Ref.get(current),
                changes: () => Stream.empty,
              }),
            ),
            Effect.provideService(
              SkillDiscovery.Service,
              SkillDiscovery.Service.of({
                pull: () =>
                  Deferred.succeed(loading, undefined).pipe(Effect.andThen(Deferred.await(release)), Effect.as([])),
              }),
            ),
            Effect.provideService(Global.Service, Global.Service.of({ ...Global.make(), home: tmp.path })),
            Effect.provideService(
              Location.Service,
              Location.Service.of(location({ directory: AbsolutePath.make(tmp.path) })),
            ),
            Effect.forkScoped,
          )
          yield* Deferred.await(loading)
          yield* Ref.set(current, [new Document({ type: "document", info: decode({ skills: [tmp.path] }) })])
          yield* PubSub.publish(events, {
            id: Event.ID.create(),
            created: Date.now(),
            type: "config.updated" as const,
            data: {},
          })
          expect(yield* Deferred.isDone(reloaded)).toBe(false)
          yield* Deferred.succeed(release, undefined)
          yield* Fiber.join(startup)
          yield* Deferred.await(reloaded).pipe(Effect.timeout("2 seconds"))
          expect((yield* skill.list()).map((item) => item.id)).toEqual([Skill.ID.make("latest")])
        }),
      ),
    ),
  )

  it.live("maps config entry types to skill directories", () =>
    Effect.acquireDisposable(Effect.promise(() => tmpdir())).pipe(
      Effect.flatMap((tmp) =>
        Effect.gen(function* () {
          const claude = path.join(tmp.path, "claude")
          const agents = path.join(tmp.path, "agents")
          const opencode = path.join(tmp.path, "opencode")
          const home = path.join(tmp.path, "home")
          const directory = path.join(tmp.path, "project")
          const expected = [
            path.join(claude, "skills"),
            path.join(agents, "skills"),
            path.join(opencode, "skill"),
            path.join(opencode, "skills"),
            path.join(home, "shared"),
            path.join(directory, "relative"),
          ]
          yield* Effect.promise(() => Promise.all(expected.map((item) => fs.mkdir(item, { recursive: true }))))

          yield* startEntries(
            [
              new ClaudeDirectory({ type: "claude", path: AbsolutePath.make(claude) }),
              new AgentsDirectory({ type: "agents", path: AbsolutePath.make(agents) }),
              new Directory({ type: "directory", path: AbsolutePath.make(opencode) }),
              new Document({ type: "document", info: decode({ skills: ["~/shared", "./relative"] }) }),
            ],
            directory,
            home,
          )
          const watcher = yield* Watcher.Test
          expect(yield* watcher.subscriptions()).toEqual(expected.map((item) => ({ path: item, type: "directory" })))
        }),
      ),
    ),
  )

  it.live("loads directory and individual downloaded skill roots with later-source precedence", () =>
    Effect.acquireDisposable(Effect.promise(() => tmpdir())).pipe(
      Effect.flatMap((tmp) =>
        Effect.gen(function* () {
          const first = path.join(tmp.path, "first")
          const second = path.join(tmp.path, "second")
          yield* Effect.promise(async () => {
            await fs.mkdir(path.join(first, "review"), { recursive: true })
            await fs.mkdir(path.join(second, "deploy"), { recursive: true })
            await fs.mkdir(path.join(second, "review"), { recursive: true })
            await write(first, "review", "First")
            await write(second, "deploy", "Deploy")
            await write(second, "review", "Second")
          })
          const pulls: string[] = []
          const discovery = SkillDiscovery.Service.of({
            pull: (url) => {
              pulls.push(url)
              return Effect.succeed([
                AbsolutePath.make(path.join(second, "deploy")),
                AbsolutePath.make(path.join(second, "review")),
              ])
            },
          })

          const skill = yield* start([first, "https://example.test/skills/"], tmp.path, discovery)
          expect((yield* skill.list()).map((item) => item.id).toSorted()).toEqual([
            Skill.ID.make("deploy"),
            Skill.ID.make("review"),
          ])
          expect((yield* skill.list()).find((item) => item.id === "deploy")?.description).toBe("Deploy")
          expect((yield* skill.list()).find((item) => item.id === "review")?.description).toBe("Second")
          expect(pulls).toEqual(["https://example.test/skills/"])
        }),
      ),
    ),
  )

  it.live("prefers a worktree skill over the parent checkout copy", () =>
    Effect.acquireDisposable(Effect.promise(() => tmpdir())).pipe(
      Effect.flatMap((tmp) =>
        Effect.gen(function* () {
          const checkout = path.join(tmp.path, "repo")
          const worktree = path.join(checkout, ".worktrees", "feature")
          const parentSkills = path.join(checkout, ".agents", "skills")
          const worktreeSkills = path.join(worktree, ".agents", "skills")
          yield* Effect.promise(async () => {
            await fs.mkdir(path.join(checkout, ".git"), { recursive: true })
            await fs.mkdir(path.join(parentSkills, "review"), { recursive: true })
            await fs.mkdir(path.join(worktreeSkills, "review"), { recursive: true })
            await fs.writeFile(path.join(worktree, ".git"), "gitdir: ../../../.git/worktrees/feature\n")
            await write(parentSkills, "review", "Parent checkout")
            await write(worktreeSkills, "review", "Worktree")
          })

          const entries = yield* discover(worktree, path.join(tmp.path, "global"))
          const skill = yield* startEntries(entries, worktree)
          const review = (yield* skill.list()).find((item) => item.id === "review")

          expect(review?.description).toBe("Worktree")
          expect(review?.location).toBe(AbsolutePath.make(path.join(worktreeSkills, "review", "SKILL.md")))
        }),
      ),
    ),
  )

  it.live("keeps directory skills when a URL source fails", () =>
    Effect.acquireDisposable(Effect.promise(() => tmpdir())).pipe(
      Effect.flatMap((tmp) =>
        Effect.gen(function* () {
          yield* Effect.promise(async () => {
            await fs.mkdir(path.join(tmp.path, "review"), { recursive: true })
            await write(tmp.path, "review", "Available")
          })
          const url = "https://unreachable.example.test/skills/"
          const discovery = SkillDiscovery.Service.of({ pull: () => Effect.die(`failed to pull ${url}`) })

          const skill = yield* start([tmp.path, url], tmp.path, discovery)
          expect((yield* skill.list()).find((item) => item.id === "review")?.description).toBe("Available")
        }),
      ),
    ),
  )

  it.live("rescans directory sources when watched files change", () =>
    Effect.acquireDisposable(Effect.promise(() => tmpdir())).pipe(
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

          yield* Effect.promise(() => fs.rm(path.join(tmp.path, "review"), { recursive: true }))
          yield* emitAndWait({ type: "delete", path: path.join(tmp.path, "review", "SKILL.md") })
          expect((yield* skill.list()).map((item) => item.id)).toEqual([Skill.ID.make("deploy")])
        }),
      ),
    ),
  )

  it.live("watches canonical directories behind symlinked skills", () =>
    Effect.acquireDisposable(Effect.promise(() => tmpdir())).pipe(
      Effect.flatMap((tmp) =>
        Effect.gen(function* () {
          const source = path.join(tmp.path, "source")
          const target = path.join(tmp.path, "target", "bro")
          const file = path.join(target, "SKILL.md")
          yield* Effect.promise(async () => {
            await fs.mkdir(source, { recursive: true })
            await fs.mkdir(target, { recursive: true })
            await fs.writeFile(file, "---\nname: bro\ndescription: Initial\n---\n# bro")
            await fs.symlink(target, path.join(source, "bro"), process.platform === "win32" ? "junction" : undefined)
          })

          const skill = yield* start([source], tmp.path)
          const watcher = yield* Watcher.Test
          expect((yield* skill.list()).find((item) => item.id === "bro")?.description).toBe("Initial")
          expect(yield* watcher.subscriptions()).toContainEqual({ path: target, type: "directory" })

          yield* Effect.promise(() => fs.writeFile(file, "---\nname: bro\ndescription: Updated\n---\n# bro"))
          yield* emitAndWait({ type: "update", path: file })
          expect((yield* skill.list()).find((item) => item.id === "bro")?.description).toBe("Updated")
        }),
      ),
    ),
  )

  it.live("reloads symlinked sources when their target changes", () =>
    Effect.acquireDisposable(Effect.promise(() => tmpdir())).pipe(
      Effect.flatMap((tmp) =>
        Effect.gen(function* () {
          const source = path.join(tmp.path, "source")
          const first = path.join(tmp.path, "first")
          const second = path.join(tmp.path, "second")
          yield* Effect.promise(async () => {
            await fs.mkdir(path.join(first, "bro"), { recursive: true })
            await fs.mkdir(path.join(second, "bro"), { recursive: true })
            await write(first, "bro", "First")
            await write(second, "bro", "Second")
            await fs.symlink(first, source, process.platform === "win32" ? "junction" : undefined)
          })

          const skill = yield* start([source], tmp.path)
          const watcher = yield* Watcher.Test
          expect((yield* skill.list()).find((item) => item.id === "bro")?.description).toBe("First")
          expect(yield* watcher.subscriptions()).toEqual([
            { path: first, type: "directory" },
            { path: source, type: "file" },
          ])

          yield* Effect.promise(async () => {
            await fs.unlink(source)
            await fs.symlink(second, source, process.platform === "win32" ? "junction" : undefined)
          })
          yield* emitAndWait({ type: "update", path: source })

          expect((yield* skill.list()).find((item) => item.id === "bro")?.description).toBe("Second")
          expect(yield* watcher.subscriptions()).toEqual([
            { path: first, type: "directory" },
            { path: source, type: "file" },
            { path: second, type: "directory" },
            { path: source, type: "file" },
          ])
        }),
      ),
    ),
  )

  it.live("follows missing source directories as their parents appear", () =>
    Effect.acquireDisposable(Effect.promise(() => tmpdir())).pipe(
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
