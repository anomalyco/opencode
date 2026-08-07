import fs from "fs/promises"
import path from "path"
import { describe, expect } from "bun:test"
import { Deferred, Effect, Fiber, Layer, Stream } from "effect"
import { Agent } from "@opencode-ai/core/agent"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/util/effect/layer-node"
import { Bus } from "@opencode-ai/core/bus"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { Skill } from "@opencode-ai/core/skill"
import { SkillDiscovery } from "@opencode-ai/core/skill/discovery"
import { Watcher } from "@opencode-ai/core/filesystem/watcher"
import { tmpdir } from "./fixture/tmpdir"
import { testEffect } from "./lib/effect"

const urls = new Map<string, AbsolutePath[]>()
let pulls = 0
const discovery = Layer.succeed(
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
    AppNodeBuilder.build(LayerNode.group([Skill.node, Agent.node, Bus.node]), [
      [SkillDiscovery.node, discovery],
      [Watcher.node, watcherLayer],
    ]),
    watcherLayer,
  ),
)

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

function waitForSkillUpdate() {
  return Effect.gen(function* () {
    const bus = yield* Bus.Service
    const deferred = yield* Deferred.make<void>()
    const fiber = yield* bus.subscribe(Skill.Event.Updated).pipe(
      Stream.runForEach(() => Deferred.succeed(deferred, undefined).pipe(Effect.asVoid)),
      Effect.forkScoped,
    )
    yield* Effect.yieldNow
    return { deferred, fiber }
  })
}

function expectSubscription(check: (input: Watcher.WatchInput) => boolean) {
  return Effect.gen(function* () {
    const watcher = yield* Watcher.Test
    expect((yield* watcher.subscriptions()).some(check)).toBe(true)
  })
}

function emitAndWait(update: Watcher.Update) {
  return Effect.gen(function* () {
    const watcher = yield* Watcher.Test
    yield* Effect.acquireUseRelease(
      waitForSkillUpdate(),
      ({ deferred }) => watcher.emit(update).pipe(Effect.andThen(Deferred.await(deferred)), Effect.timeout("1 second")),
      ({ fiber }) => Fiber.interrupt(fiber),
    )
  })
}

describe("Skill", () => {
  it.live("publishes updates when skill sources change", () =>
    Effect.gen(function* () {
      const skill = yield* Skill.Service

      yield* Effect.acquireUseRelease(
        waitForSkillUpdate(),
        ({ deferred }) =>
          skill
            .transform((editor) =>
              editor.source({ type: "directory", path: AbsolutePath.make("/tmp/opencode-skills") }),
            )
            .pipe(Effect.andThen(Deferred.await(deferred)), Effect.timeout("1 second")),
        ({ fiber }) => Fiber.interrupt(fiber),
      )
    }),
  )

  it.live("registers sources and resolves later source precedence", () =>
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
            await fs.writeFile(path.join(first, "foo.md"), "---\nslash: true\n---\n# foo")
          })

          const skill = yield* Skill.Service
          const watcher = yield* Watcher.Test
          yield* skill.transform((editor) => {
            editor.source({ type: "directory", path: AbsolutePath.make(first) })
            editor.source({ type: "directory", path: AbsolutePath.make(first) })
            editor.source({ type: "directory", path: AbsolutePath.make(second) })
            expect(editor.list()).toEqual([
              { type: "directory", path: AbsolutePath.make(first) },
              { type: "directory", path: AbsolutePath.make(second) },
            ])
          })

          expect(yield* skill.sources()).toEqual([
            { type: "directory", path: AbsolutePath.make(first) },
            { type: "directory", path: AbsolutePath.make(second) },
          ])
          expect(yield* skill.list()).toEqual([
            Skill.Info.make({
              id: Skill.ID.make("foo"),
              name: Skill.Name.make("foo"),
              slash: true,
              location: AbsolutePath.make(path.join(first, "foo.md")),
              content: "# foo",
            }),
            {
              id: Skill.ID.make("review"),
              name: Skill.Name.make("review"),
              description: "Second",
              location: AbsolutePath.make(path.join(second, "review", "SKILL.md")),
              content: "# review",
            },
          ])
          expect(yield* watcher.subscriptions()).toEqual([
            { path: first, type: "directory" },
            { path: second, type: "directory" },
          ])

          yield* Effect.promise(() => write(second, "review", "Updated Second"))
          yield* emitAndWait({ type: "update", path: path.join(second, "review", "SKILL.md") })

          expect((yield* skill.list()).find((item) => item.id === "review")?.description).toBe("Updated Second")
          expect(yield* watcher.subscriptions()).toEqual([
            { path: first, type: "directory" },
            { path: second, type: "directory" },
            { path: first, type: "directory" },
            { path: second, type: "directory" },
          ])
        }),
      ),
    ),
  )

  it.live("loads URL sources and filters skills for agents", () =>
    Effect.acquireRelease(
      Effect.promise(() => tmpdir()),
      (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
    ).pipe(
      Effect.flatMap((tmp) =>
        Effect.gen(function* () {
          yield* Effect.promise(async () => {
            await fs.mkdir(path.join(tmp.path, "deploy"), { recursive: true })
            await write(tmp.path, "deploy", "Deploy production")
          })
          pulls = 0
          urls.set("https://example.test/skills/", [AbsolutePath.make(tmp.path)])

          const agents = yield* Agent.Service
          yield* agents.transform((editor) =>
            editor.update(Agent.ID.make("reviewer"), (agent) => {
              agent.permissions.push({ action: "skill", resource: "deploy", effect: "deny" })
            }),
          )

          const skill = yield* Skill.Service
          yield* skill.transform((editor) => editor.source({ type: "url", url: "https://example.test/skills/" }))

          expect((yield* skill.list()).map((item) => item.name)).toEqual([Skill.Name.make("deploy")])
          expect((yield* skill.list()).map((item) => item.name)).toEqual([Skill.Name.make("deploy")])
          expect(pulls).toBe(1)
          expect(Skill.available(yield* skill.list(), (yield* agents.get(Agent.ID.make("reviewer")))!)).toEqual([])
        }),
      ),
    ),
  )

  it.live("parses opencode metadata flags from skill frontmatter", () =>
    Effect.acquireRelease(
      Effect.promise(() => tmpdir()),
      (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
    ).pipe(
      Effect.flatMap((tmp) =>
        Effect.gen(function* () {
          yield* Effect.promise(async () => {
            await fs.mkdir(path.join(tmp.path, "manual"), { recursive: true })
            await fs.writeFile(
              path.join(tmp.path, "manual", "SKILL.md"),
              `---
name: manual
description: Manual only
metadata:
  opencode/slash: true
  opencode/autoinvoke: false
---
# manual`,
            )
          })

          const skill = yield* Skill.Service
          yield* skill.transform((editor) => editor.source({ type: "directory", path: AbsolutePath.make(tmp.path) }))

          expect(yield* skill.list()).toEqual([
            {
              id: Skill.ID.make("manual"),
              name: Skill.Name.make("manual"),
              description: "Manual only",
              slash: true,
              autoinvoke: false,
              location: AbsolutePath.make(path.join(tmp.path, "manual", "SKILL.md")),
              content: "# manual",
            },
          ])
        }),
      ),
    ),
  )

  it.live("clears cached skills when sources reload", () =>
    Effect.acquireRelease(
      Effect.promise(() => tmpdir()),
      (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
    ).pipe(
      Effect.flatMap((tmp) =>
        Effect.gen(function* () {
          yield* Effect.promise(async () => {
            await fs.mkdir(path.join(tmp.path, "deploy"), { recursive: true })
            await write(tmp.path, "deploy", "Initial deploy")
          })

          const skill = yield* Skill.Service
          const watcher = yield* Watcher.Test
          const bus = yield* Bus.Service
          yield* skill.transform((editor) => editor.source({ type: "directory", path: AbsolutePath.make(tmp.path) }))
          expect((yield* skill.list()).find((item) => item.id === "deploy")?.description).toBe("Initial deploy")
          expect(yield* watcher.subscriptions()).toEqual([{ path: tmp.path, type: "directory" }])

          let refreshed: Skill.Info[] = []
          const unsubscribe = yield* bus.listen((event) => {
            if (event.type !== Skill.Event.Updated.type) return Effect.void
            return skill.list().pipe(
              Effect.tap((items) => Effect.sync(() => (refreshed = items))),
              Effect.asVoid,
            )
          })

          yield* Effect.promise(() => write(tmp.path, "deploy", "Updated deploy"))
          yield* skill.reload().pipe(Effect.timeout("1 second"))
          yield* unsubscribe

          expect(refreshed.find((item) => item.id === "deploy")?.description).toBe("Updated deploy")
          expect(yield* watcher.subscriptions()).toEqual([
            { path: tmp.path, type: "directory" },
            { path: tmp.path, type: "directory" },
          ])
        }),
      ),
    ),
  )

  it.live("reloads project sources created after their missing parent", () =>
    Effect.acquireRelease(
      Effect.promise(() => tmpdir()),
      (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
    ).pipe(
      Effect.flatMap((tmp) =>
        Effect.gen(function* () {
          const source = path.join(tmp.path, "generated", "skills")
          const file = path.join(source, "deploy", "SKILL.md")
          const skill = yield* Skill.Service
          const watcher = yield* Watcher.Test
          yield* skill.transform((editor) => editor.source({ type: "directory", path: AbsolutePath.make(source) }))
          expect(yield* skill.list()).toEqual([])
          expect(yield* watcher.subscriptions()).toEqual([{ path: path.join(tmp.path, "generated"), type: "file" }])

          yield* Effect.promise(() => fs.mkdir(path.join(tmp.path, "generated")))
          yield* emitAndWait({ type: "create", path: path.join(tmp.path, "generated") })
          expect(yield* skill.list()).toEqual([])
          expect(yield* watcher.subscriptions()).toEqual([
            { path: path.join(tmp.path, "generated"), type: "file" },
            { path: source, type: "file" },
          ])

          yield* Effect.promise(async () => {
            await fs.mkdir(path.dirname(file), { recursive: true })
            await write(source, "deploy", "Deploy production")
          })
          yield* emitAndWait({ type: "create", path: source })

          expect((yield* skill.list()).map((item) => item.id)).toEqual([Skill.ID.make("deploy")])
          expect(yield* watcher.subscriptions()).toEqual([
            { path: path.join(tmp.path, "generated"), type: "file" },
            { path: source, type: "file" },
            { path: source, type: "directory" },
          ])
        }),
      ),
    ),
  )

  it.live("watches directory sources for added and changed skills", () =>
    Effect.acquireRelease(
      Effect.promise(() => tmpdir()),
      (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
    ).pipe(
      Effect.flatMap((tmp) =>
        Effect.gen(function* () {
          yield* Effect.promise(async () => {
            await fs.mkdir(path.join(tmp.path, "deploy"), { recursive: true })
            await write(tmp.path, "deploy", "Initial deploy")
          })

          const skill = yield* Skill.Service
          yield* skill.transform((editor) => editor.source({ type: "directory", path: AbsolutePath.make(tmp.path) }))
          expect((yield* skill.list()).map((item) => item.id)).toEqual([Skill.ID.make("deploy")])
          yield* expectSubscription((input) => input.type === "directory" && input.path === tmp.path)

          const deploy = path.join(tmp.path, "deploy", "SKILL.md")
          yield* Effect.promise(() => write(tmp.path, "deploy", "Updated deploy"))
          yield* emitAndWait({ type: "update", path: deploy })
          expect((yield* skill.list()).find((item) => item.id === "deploy")?.description).toBe("Updated deploy")

          yield* Effect.promise(async () => {
            await fs.mkdir(path.join(tmp.path, "review"), { recursive: true })
            await write(tmp.path, "review", "Review changes")
          })
          const review = path.join(tmp.path, "review", "SKILL.md")
          yield* emitAndWait({ type: "create", path: review })
          expect((yield* skill.list()).map((item) => item.id)).toEqual([
            Skill.ID.make("deploy"),
            Skill.ID.make("review"),
          ])

          yield* Effect.promise(() => fs.rm(path.join(tmp.path, "review"), { recursive: true }))
          yield* emitAndWait({ type: "delete", path: review })
          expect((yield* skill.list()).map((item) => item.id)).toEqual([Skill.ID.make("deploy")])
        }),
      ),
    ),
  )

  it.live("watches canonical directories behind symlinked skills", () =>
    Effect.acquireRelease(
      Effect.promise(() => tmpdir()),
      (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
    ).pipe(
      Effect.flatMap((tmp) =>
        Effect.gen(function* () {
          const source = path.join(tmp.path, "source")
          const target = path.join(tmp.path, "target", "bro")
          const file = path.join(target, "SKILL.md")
          yield* Effect.promise(async () => {
            await fs.mkdir(source, { recursive: true })
            await fs.mkdir(target, { recursive: true })
            await fs.writeFile(file, "---\nname: bro\ndescription: Initial\n---\n# bro")
            await fs.symlink(target, path.join(source, "bro"))
          })

          const skill = yield* Skill.Service
          yield* skill.transform((editor) => editor.source({ type: "directory", path: AbsolutePath.make(source) }))
          expect((yield* skill.list()).find((item) => item.id === "bro")?.description).toBe("Initial")
          yield* expectSubscription((input) => input.type === "directory" && input.path === target)

          yield* Effect.promise(() => fs.writeFile(file, "---\nname: bro\ndescription: Updated\n---\n# bro"))
          yield* emitAndWait({ type: "update", path: file })
          expect((yield* skill.list()).find((item) => item.id === "bro")?.description).toBe("Updated")
        }),
      ),
    ),
  )

  it.live("invalidates symlinked sources when their target changes", () =>
    Effect.acquireRelease(
      Effect.promise(() => tmpdir()),
      (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
    ).pipe(
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
            await fs.symlink(first, source)
          })

          const skill = yield* Skill.Service
          const watcher = yield* Watcher.Test
          yield* skill.transform((editor) => editor.source({ type: "directory", path: AbsolutePath.make(source) }))
          expect((yield* skill.list()).find((item) => item.id === "bro")?.description).toBe("First")
          expect(yield* watcher.subscriptions()).toEqual([
            { path: first, type: "directory" },
            { path: source, type: "file" },
          ])

          yield* Effect.promise(async () => {
            await fs.unlink(source)
            await fs.symlink(second, source)
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
})
