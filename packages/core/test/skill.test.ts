import fs from "fs/promises"
import path from "path"
import { describe, expect } from "bun:test"
import { Duration, Effect, Layer } from "effect"
import * as TestClock from "effect/testing/TestClock"
import { AgentV2 } from "@opencode-ai/core/agent"
import { Config } from "@opencode-ai/core/config"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Database } from "@opencode-ai/core/database/database"
import { EventV2 } from "@opencode-ai/core/event"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { Watcher } from "@opencode-ai/core/filesystem/watcher"
import { Location } from "@opencode-ai/core/location"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { SkillV2 } from "@opencode-ai/core/skill"
import { SkillDiscovery } from "@opencode-ai/core/skill/discovery"
import { location } from "./fixture/location"
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

const watcherLayer = Layer.succeed(
  Watcher.Service,
  Watcher.Service.of({ watch: () => Effect.succeed(Effect.void) }),
)

const it = testEffect(
  AppNodeBuilder.build(LayerNode.group([SkillV2.node, AgentV2.node, Database.node, EventV2.node]), [
    [SkillDiscovery.node, discovery],
    [Watcher.node, watcherLayer],
  ]),
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

describe("SkillV2", () => {
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

          const skill = yield* SkillV2.Service
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
            SkillV2.Info.make({
              name: "foo",
              slash: true,
              location: AbsolutePath.make(path.join(first, "foo.md")),
              content: "# foo",
            }),
            {
              name: "review",
              description: "Second",
              location: AbsolutePath.make(path.join(second, "review", "SKILL.md")),
              content: "# review",
            },
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

          const agents = yield* AgentV2.Service
          yield* agents.transform((editor) =>
            editor.update(AgentV2.ID.make("reviewer"), (agent) => {
              agent.permissions.push({ action: "skill", resource: "deploy", effect: "deny" })
            }),
          )

          const skill = yield* SkillV2.Service
          yield* skill.transform((editor) => editor.source({ type: "url", url: "https://example.test/skills/" }))

          expect((yield* skill.list()).map((item) => item.name)).toEqual(["deploy"])
          expect((yield* skill.list()).map((item) => item.name)).toEqual(["deploy"])
          expect(pulls).toBe(1)
          expect(SkillV2.available(yield* skill.list(), (yield* agents.get(AgentV2.ID.make("reviewer")))!)).toEqual([])
        }),
      ),
    ),
  )

  it.live("keeps directory source cache when the source is replayed without watcher events", () =>
    Effect.acquireRelease(
      Effect.promise(() => tmpdir()),
      (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
    ).pipe(
      Effect.flatMap((tmp) =>
        Effect.gen(function* () {
          const dir = path.join(tmp.path, "skills")
          yield* Effect.promise(async () => {
            await fs.mkdir(path.join(dir, "review"), { recursive: true })
            await write(dir, "review", "First")
          })

          const skill = yield* SkillV2.Service
          yield* skill.transform((editor) => editor.source({ type: "directory", path: AbsolutePath.make(dir) }))
          expect((yield* skill.list()).map((item) => item.description)).toEqual(["First"])

          yield* Effect.promise(async () => {
            await fs.mkdir(path.join(dir, "review"), { recursive: true })
            await write(dir, "review", "Second")
          })

          // Replaying the same transform does not refresh directory sources;
          // file changes are discovered through watcher events instead.
          yield* skill.transform((editor) => editor.source({ type: "directory", path: AbsolutePath.make(dir) }))
          expect((yield* skill.list()).map((item) => item.description)).toEqual(["First"])
        }),
      ),
    ),
  )

  it.live("clears cache for removed sources", () =>
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

          const skill = yield* SkillV2.Service
          const registration = yield* skill.transform((editor) => {
            editor.source({ type: "directory", path: AbsolutePath.make(first) })
            editor.source({ type: "directory", path: AbsolutePath.make(second) })
          })
          // Later source wins for duplicate skill names.
          expect((yield* skill.list()).map((item) => item.description)).toEqual(["Second"])

          yield* registration.dispose
          expect(yield* skill.list()).toEqual([])
        }),
      ),
    ),
  )

  it.live("invalidates directory source cache on watcher events", () =>
    Effect.acquireRelease(
      Effect.promise(() => tmpdir()),
      (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
    ).pipe(
      Effect.flatMap((tmp) =>
        Effect.gen(function* () {
          const dir = path.join(tmp.path, "skills")
          yield* Effect.promise(async () => {
            await fs.mkdir(path.join(dir, "review"), { recursive: true })
            await write(dir, "review", "First")
          })

          const events = yield* EventV2.Service
          const skill = yield* SkillV2.Service
          yield* skill.transform((editor) => editor.source({ type: "directory", path: AbsolutePath.make(dir) }))
          expect((yield* skill.list()).map((item) => item.description)).toEqual(["First"])

          yield* Effect.promise(async () => {
            await fs.mkdir(path.join(dir, "review"), { recursive: true })
            await write(dir, "review", "Second")
          })

          yield* events.publish(Watcher.Event.Updated, {
            file: path.join(dir, "review", "SKILL.md"),
            event: "change",
          })
          yield* Effect.yieldNow

          expect((yield* skill.list()).map((item) => item.description)).toEqual(["Second"])
        }),
      ),
    ),
  )

  it.effect("refreshes URL source cache on the periodic timer", () =>
    Effect.gen(function* () {
      const url = "https://example.test/refresh/"
      pulls = 0
      urls.set(url, [])

      const skill = yield* SkillV2.Service
      yield* skill.transform((editor) => editor.source({ type: "url", url }))

      expect(yield* skill.list()).toEqual([])
      expect(pulls).toBe(1)

      const dir = yield* Effect.promise(() => tmpdir())
      yield* Effect.promise(async () => {
        await fs.mkdir(path.join(dir.path, "deploy"), { recursive: true })
        await write(dir.path, "deploy", "Deploy production")
      })
      // Simulate the remote catalog changing with no local config/plugin reload.
      urls.set(url, [AbsolutePath.make(dir.path)])

      // Still cached until the periodic refresh fires.
      expect(yield* skill.list()).toEqual([])
      expect(pulls).toBe(1)

      yield* TestClock.adjust(Duration.minutes(60))
      yield* Effect.yieldNow

      expect((yield* skill.list()).map((item) => item.name)).toEqual(["deploy"])
      expect(pulls).toBe(2)

      yield* Effect.promise(() => dir[Symbol.asyncDispose]())
    }),
  )
})

const describeRealWatcher = Watcher.hasNativeBinding() && !process.env.CI ? describe : describe.skip

describeRealWatcher("SkillV2 with a real filesystem watcher", () => {
  // A separate, minimal `it` is required here: the file-level `it` already
  // bakes a stubbed Watcher.node into its base layer (for the other tests
  // above), and providing a second, real Watcher.node per-test on top of that
  // base does not take effect. Mirrors the pattern in
  // test/filesystem/watcher.test.ts, whose shared `it` has no Watcher.node
  // (or SkillV2.node) in its base layer either.
  const itReal = testEffect(Layer.empty)

  const configLayer = Layer.succeed(Config.Service, Config.Service.of({ entries: () => Effect.succeed([]) }))

  function provideRealWatcher(directory: string) {
    return Effect.provide(
      AppNodeBuilder.build(LayerNode.group([SkillV2.node, AgentV2.node, Database.node, EventV2.node]), [
        [SkillDiscovery.node, discovery],
        [Config.node, configLayer],
        [
          Location.node,
          Layer.succeed(Location.Service, Location.Service.of(location({ directory: AbsolutePath.make(directory) }))),
        ],
      ]),
    )
  }

  itReal.live(
    "invalidates a symlinked directory source through the real watcher",
    () =>
      Effect.acquireRelease(
        Effect.promise(() => tmpdir()),
        (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
      ).pipe(
        Effect.flatMap((tmp) =>
          Effect.gen(function* () {
            const real = path.join(tmp.path, "real-skills")
            const link = path.join(tmp.path, "linked-skills")
            yield* Effect.promise(async () => {
              await fs.mkdir(path.join(real, "review"), { recursive: true })
              await write(real, "review", "First")
              await fs.symlink(real, link)
            })

            const skill = yield* SkillV2.Service
            yield* skill.transform((editor) => editor.source({ type: "directory", path: AbsolutePath.make(link) }))
            expect((yield* skill.list()).map((item) => item.description)).toEqual(["First"])

            yield* Effect.promise(async () => {
              await fs.mkdir(path.join(real, "review"), { recursive: true })
              await write(real, "review", "Second")
            })

            yield* Effect.gen(function* () {
              let attempt = 0
              while (attempt < 20) {
                const list = yield* skill.list()
                if (list.some((item) => item.description === "Second")) return
                yield* Effect.sleep("250 millis")
                attempt++
              }
              return yield* Effect.fail(new Error("timed out waiting for the real watcher to invalidate the cache"))
            })
          }).pipe(provideRealWatcher(tmp.path)),
        ),
      ),
    10000,
  )
})
