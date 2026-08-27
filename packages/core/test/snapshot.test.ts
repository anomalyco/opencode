import { $ } from "bun"
import { describe, expect } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { Deferred, Effect, Fiber, Function, Layer } from "effect"
import { TestClock } from "effect/testing"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { Git } from "@opencode-ai/core/git"
import { Global } from "@opencode-ai/util/global"
import { Location } from "@opencode-ai/core/location"
import { AbsolutePath, RelativePath } from "@opencode-ai/core/schema"
import { Snapshot } from "@opencode-ai/core/snapshot"
import { Hash } from "@opencode-ai/util/hash"
import { EffectFlock } from "@opencode-ai/util/effect-flock"
import { tmpdir } from "./fixture/tmpdir"
import { testEffect } from "./lib/effect"

describe("Snapshot", () => {
  testEffect(Layer.empty).live("keeps lazy repository discovery after the first caller is interrupted", () =>
    Effect.acquireUseRelease(
      Effect.promise(() => tmpdir()),
      (tmp) =>
        Effect.gen(function* () {
          const project = path.join(tmp.path, "project")
          yield* Effect.promise(async () => {
            await fs.mkdir(project)
            await fs.writeFile(path.join(project, "tracked.txt"), "one\n")
            await initGit(project)
          })

          const git = yield* Git.Service.pipe(Effect.provide(AppNodeBuilder.build(Git.node)))
          const location = yield* Location.Service.pipe(
            Effect.provide(
              AppNodeBuilder.build(Location.boundNode(Location.Ref.make({ directory: AbsolutePath.make(project) }))),
            ),
          )
          const started = yield* Deferred.make<void>()
          const release = yield* Deferred.make<void>()
          let discoveries = 0
          let creations = 0
          const instrumented = Git.Service.of({
            ...git,
            repo: {
              ...git.repo,
              discover: (input) => {
                discoveries++
                return git.repo.discover(input)
              },
              create: (input) =>
                Effect.gen(function* () {
                  creations++
                  yield* Deferred.succeed(started, undefined)
                  yield* Deferred.await(release)
                  return yield* git.repo.create(input)
                }),
            },
          })
          const layer = AppNodeBuilder.build(Snapshot.node, [
            [Location.node, Layer.succeed(Location.Service, location)],
            [Global.node, Global.layerWith({ data: tmp.path, config: path.join(tmp.path, "config") })],
            [Git.node, Layer.succeed(Git.Service, instrumented)],
          ])

          yield* Effect.gen(function* () {
            const snapshot = yield* Snapshot.Service
            expect(discoveries).toBe(0)

            const interrupted = yield* snapshot.capture().pipe(Effect.forkChild)
            yield* Deferred.await(started)
            expect(discoveries).toBe(1)
            expect(creations).toBe(1)
            yield* Fiber.interrupt(interrupted)

            const capture = yield* snapshot.capture().pipe(Effect.forkChild)
            expect(discoveries).toBe(1)
            expect(creations).toBe(1)
            yield* Deferred.succeed(release, undefined)
            expect(yield* Fiber.join(capture)).toBeDefined()
            expect(discoveries).toBe(1)
            expect(creations).toBe(1)
          }).pipe(Effect.provide(layer))
        }),
      (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
    ),
  )

  testEffect(Layer.empty).live("captures and restores Location-scoped changes", () =>
    Effect.acquireUseRelease(
      Effect.promise(() => tmpdir()),
      (tmp) =>
        Effect.gen(function* () {
          const project = path.join(tmp.path, "project")
          const location = path.join(project, "scope")
          yield* Effect.promise(async () => {
            await fs.mkdir(location, { recursive: true })
            await fs.writeFile(path.join(location, "tracked.txt"), "one\n")
            await fs.writeFile(path.join(project, "outside.txt"), "outside\n")
            await initGit(project)
          })

          const layer = snapshotLayer(tmp.path, location)
          yield* Effect.gen(function* () {
            const snapshot = yield* Snapshot.Service
            const before = yield* snapshot.capture()
            expect(before).toBeDefined()
            if (!before) return

            yield* Effect.promise(async () => {
              await fs.writeFile(path.join(location, "tracked.txt"), "two\n")
              await fs.writeFile(path.join(location, "added.txt"), "added\n")
              await fs.writeFile(path.join(project, "outside.txt"), "changed outside\n")
            })
            const after = yield* snapshot.capture()
            expect(after).toBeDefined()
            if (!after) return

            expect(yield* snapshot.files({ from: before, to: after })).toEqual([
              RelativePath.make("scope/added.txt"),
              RelativePath.make("scope/tracked.txt"),
            ])
            const plan = new Map([[RelativePath.make("scope/tracked.txt"), before]])
            yield* snapshot.restore({ files: plan })
            expect(yield* read(path.join(location, "tracked.txt"))).toBe("one\n")
            expect(yield* read(path.join(location, "added.txt"))).toBe("added\n")
            expect(yield* read(path.join(project, "outside.txt"))).toBe("changed outside\n")
          }).pipe(Effect.provide(layer))
        }),
      (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
    ),
  )

  testEffect(Layer.empty).live("retries lazy repository initialization after lock timeout", () =>
    Effect.acquireUseRelease(
      Effect.promise(() => tmpdir()),
      (tmp) =>
        Effect.gen(function* () {
          const project = path.join(tmp.path, "project")
          yield* Effect.promise(async () => {
            await fs.mkdir(project)
            await fs.writeFile(path.join(project, "tracked.txt"), "one\n")
            await initGit(project)
          })
          const flock = yield* EffectFlock.Service.pipe(Effect.provide(AppNodeBuilder.build(EffectFlock.node)))
          let acquisitions = 0
          const withLock: EffectFlock.Interface["withLock"] = Function.dual(
            (args) => Effect.isEffect(args[0]),
            <A, E, R>(body: Effect.Effect<A, E, R>, key: string, directory?: string, options?: EffectFlock.Options) => {
              acquisitions++
              if (acquisitions === 1) return Effect.fail(new EffectFlock.LockTimeoutError({ key }))
              return flock.withLock(body, key, directory, options)
            },
          )
          const instrumented = EffectFlock.Service.of({
            ...flock,
            withLock,
          })
          const layer = AppNodeBuilder.build(Snapshot.node, [
            [
              Location.node,
              Location.boundNode(Location.Ref.make({ directory: AbsolutePath.make(project) })),
            ],
            [Global.node, Global.layerWith({ data: tmp.path, config: path.join(tmp.path, "config") })],
            [EffectFlock.node, Layer.succeed(EffectFlock.Service, instrumented)],
          ])

          yield* Effect.gen(function* () {
            const snapshot = yield* Snapshot.Service
            expect(yield* snapshot.capture()).toBeUndefined()
            expect(acquisitions).toBe(1)
            yield* TestClock.adjust("5 seconds")
            expect(yield* snapshot.capture()).toBeDefined()
            expect(acquisitions).toBe(3)
          }).pipe(Effect.provide(layer), Effect.provide(TestClock.layer()))
        }),
      (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
    ),
  )

  testEffect(Layer.empty).live("backs off a stale index lock and recovers without removing it", () =>
    Effect.acquireUseRelease(
      Effect.promise(() => tmpdir()),
      (tmp) =>
        Effect.gen(function* () {
          const project = path.join(tmp.path, "project")
          yield* Effect.promise(async () => {
            await fs.mkdir(project)
            await fs.writeFile(path.join(project, "tracked.txt"), "one\n")
            await initGit(project)
          })
          const projectID = yield* Effect.gen(function* () {
            return (yield* Location.Service).project.id
          }).pipe(
            Effect.provide(
              AppNodeBuilder.build(Location.boundNode(Location.Ref.make({ directory: AbsolutePath.make(project) }))),
            ),
          )
          const lock = path.join(
            tmp.path,
            "snapshot",
            projectID,
            Hash.fast(yield* Effect.promise(() => fs.realpath(project))),
            "index.lock",
          )

          yield* Effect.gen(function* () {
            const snapshot = yield* Snapshot.Service
            expect(yield* snapshot.capture()).toBeDefined()
            yield* Effect.promise(() => fs.writeFile(lock, ""))
            yield* Effect.promise(() => fs.writeFile(path.join(project, "tracked.txt"), "two\n"))

            expect(yield* snapshot.capture()).toBeUndefined()
            expect(yield* Effect.promise(() => fs.stat(lock))).toBeDefined()
            yield* Effect.promise(() => fs.rm(lock))
            expect(yield* snapshot.capture()).toBeUndefined()

            yield* TestClock.adjust("5 seconds")
            expect(yield* snapshot.capture()).toBeDefined()
          }).pipe(Effect.provide(snapshotLayer(tmp.path, project)), Effect.provide(TestClock.layer()))
        }),
      (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
    ),
  )

  testEffect(Layer.empty).live("applies availability transforms", () =>
    Effect.acquireUseRelease(
      Effect.promise(() => tmpdir()),
      (tmp) =>
        Effect.gen(function* () {
          const project = path.join(tmp.path, "project")
          yield* Effect.promise(async () => {
            await fs.mkdir(project)
            await fs.writeFile(path.join(project, "tracked.txt"), "one\n")
            await initGit(project)
          })

          yield* Effect.gen(function* () {
            const snapshot = yield* Snapshot.Service
            const registration = yield* snapshot.transform((draft) => draft.configure(false))
            expect(yield* snapshot.capture()).toBeUndefined()

            yield* registration.dispose
            expect(yield* snapshot.capture()).toBeDefined()
          }).pipe(Effect.provide(snapshotLayer(tmp.path, project)))
        }),
      (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
    ),
  )

  testEffect(Layer.empty).live("treats capture outside Git as unavailable", () =>
    Effect.acquireUseRelease(
      Effect.promise(() => tmpdir()),
      (tmp) =>
        Effect.gen(function* () {
          expect(
            yield* Effect.gen(function* () {
              const snapshot = yield* Snapshot.Service
              return yield* snapshot.capture()
            }).pipe(Effect.provide(snapshotLayer(tmp.path, tmp.path))),
          ).toBeUndefined()
        }),
      (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
    ),
  )

  testEffect(Layer.empty).live(
    "isolates snapshot indexes by canonical Git worktree",
    () =>
      Effect.acquireUseRelease(
        Effect.promise(() => tmpdir()),
        (tmp) =>
          Effect.gen(function* () {
            const project = path.join(tmp.path, "project")
            const linked = path.join(tmp.path, "linked")
            yield* Effect.promise(async () => {
              await fs.mkdir(project)
              await fs.writeFile(path.join(project, "tracked.txt"), "main\n")
              await initGit(project, true)
              await $`git -c core.fsmonitor=false worktree add --detach ${linked} HEAD`.cwd(project).quiet()
            })

            const capture = (directory: string) =>
              Effect.gen(function* () {
                const snapshot = yield* Snapshot.Service
                return yield* snapshot.capture()
              }).pipe(Effect.provide(snapshotLayer(tmp.path, directory)))
            expect(yield* capture(project)).toBeDefined()
            expect(yield* capture(linked)).toBeDefined()

            const projectID = yield* Effect.gen(function* () {
              return (yield* Location.Service).project.id
            }).pipe(
              Effect.provide(
                AppNodeBuilder.build(Location.boundNode(Location.Ref.make({ directory: AbsolutePath.make(project) }))),
              ),
            )
            expect(
              yield* Effect.promise(() => fs.stat(path.join(tmp.path, "snapshot", projectID, Hash.fast(project)))),
            ).toBeDefined()
            expect(
              yield* Effect.promise(() => fs.stat(path.join(tmp.path, "snapshot", projectID, Hash.fast(linked)))),
            ).toBeDefined()
          }),
        (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
      ),
    { timeout: 15_000 },
  )
})

function snapshotLayer(data: string, directory: string) {
  return AppNodeBuilder.build(Snapshot.node, [
    [Location.node, Location.boundNode(Location.Ref.make({ directory: AbsolutePath.make(directory) }))],
    [Global.node, Global.layerWith({ data, config: path.join(data, "config") })],
  ])
}

function read(file: string) {
  return Effect.promise(() => fs.readFile(file, "utf8")).pipe(Effect.map((content) => content.replaceAll("\r\n", "\n")))
}

async function initGit(directory: string, commit = false) {
  await $`git init`.cwd(directory).quiet()
  await $`git -c core.fsmonitor=false add .`.cwd(directory).quiet()
  if (!commit) return
  await $`git -c user.email=test@opencode.test -c user.name=Test commit --no-gpg-sign -m initial`.cwd(directory).quiet()
}
