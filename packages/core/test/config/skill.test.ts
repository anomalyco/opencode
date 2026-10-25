import fs from "fs/promises"
import path from "path"
import { describe, expect } from "bun:test"
import { Effect, Layer, Schema } from "effect"
import { Config } from "@bolt-ai/core/config"
import { ConfigSkillPlugin } from "@bolt-ai/core/config/plugin/skill"
import { Global } from "@bolt-ai/core/global"
import { Location } from "@bolt-ai/core/location"
import { AbsolutePath } from "@bolt-ai/core/schema"
import { SkillV2 } from "@bolt-ai/core/skill"
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
  compatibility: { readonly claude: readonly AbsolutePath[]; readonly agents: readonly AbsolutePath[] } = {
    claude: [],
    agents: [],
  },
) {
  const service = yield* Skill.Service
  const pluginHost = host({
    skill: {
      list: () => Effect.die("unused skill.list"),
      transform: service.transform,
      reload: service.reload,
    },
  })
  yield* ConfigCompatibilityPlugin.Plugin.effect(pluginHost).pipe(
    Effect.provide(Config.testLayer(entries, compatibility)),
  )
  yield* ConfigSkillPlugin.Plugin.effect(
    pluginHost,
  ).pipe(
    Effect.provide(Config.testLayer(entries, compatibility)),
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
    return { entries: yield* config.entries(), compatibility: yield* config.compatibility!() }
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
  test("reads disable-model-invocation as autoinvoke", () => {
    const parse = (frontmatter: string) =>
      SkillFile.parse("/repo/skills", "/repo/skills/deploy/SKILL.md", `---\n${frontmatter}\n---\n# deploy`)
    expect(parse("disable-model-invocation: true")).toMatchObject({ skill: { autoinvoke: false } })
    expect(parse("disable-model-invocation: yes")).toMatchObject({ skill: { autoinvoke: false } })
    expect(parse("disable-model-invocation: false")).not.toMatchObject({ skill: { autoinvoke: expect.anything() } })
    expect(parse("disable-model-invocation: maybe")).not.toMatchObject({ skill: { autoinvoke: expect.anything() } })
    expect(
      parse("disable-model-invocation: true\nmetadata:\n  opencode/autoinvoke: true"),
    ).toMatchObject({ skill: { autoinvoke: true } })
  })

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
        autoinvoke: false,
        path: AbsolutePath.make("/repo/skills/manual/SKILL.md"),
        content: "# manual",
      },
    })
    expect(SkillFile.parse(directory, "/repo/skills/foo.md", "# foo")).toMatchObject({
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
  })
})

describe("ConfigSkillPlugin.Plugin", () => {
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
              new Directory({ type: "directory", path: AbsolutePath.make(opencode) }),
              new Document({ type: "document", info: decode({ skills: ["~/shared", "./relative"] }) }),
            ],
            directory,
            home,
            emptyDiscovery,
            { claude: [AbsolutePath.make(claude)], agents: [AbsolutePath.make(agents)] },
          )
          const watcher = yield* Watcher.Test
          expect(yield* watcher.subscriptions()).toEqual(expected.map((item) => ({ path: item, type: "directory", ignore: SkillScan.ignore.toSorted() })))
        }),
      ).pipe(
        Effect.provideService(Global.Service, Global.Service.of({ ...Global.make(), home: "/home/test" })),
        Effect.provideService(Location.Service, Location.Service.of(location({ directory }))),
        Effect.provideService(
          Config.Service,
          Config.Service.of({
            entries: () =>
              Effect.succeed([
                new Config.Directory({ type: "directory", path: AbsolutePath.make("/repo/.bolt") }),
                new Config.Document({
                  type: "document",
                  info: decode({
                    skills: ["./skills", "~/shared-skills", "/opt/skills", "https://example.test/skills/"],
                  }),
                }),
              ]),
          }),
        ),
      )

      expect(sources).toEqual([
        SkillV2.DirectorySource.make({
          type: "directory",
          path: AbsolutePath.make(path.join("/repo/.bolt", "skill")),
        }),
        SkillV2.DirectorySource.make({
          type: "directory",
          path: AbsolutePath.make(path.join("/repo/.bolt", "skills")),
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

  it.live("watches canonical files behind symlinked skills", () =>
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
          expect(yield* watcher.subscriptions()).toContainEqual({ path: file, type: "file" })

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
            { path: first, type: "directory", ignore: SkillScan.ignore.toSorted() },
            { path: source, type: "file" },
          ])

          yield* Effect.promise(async () => {
            await fs.unlink(source)
            await fs.symlink(second, source, process.platform === "win32" ? "junction" : undefined)
          })
          yield* emitAndWait({ type: "update", path: source })

          expect((yield* skill.list()).find((item) => item.id === "bro")?.description).toBe("Second")
          expect(yield* watcher.subscriptions()).toEqual([
            { path: first, type: "directory", ignore: SkillScan.ignore.toSorted() },
            { path: source, type: "file" },
            { path: second, type: "directory", ignore: SkillScan.ignore.toSorted() },
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
