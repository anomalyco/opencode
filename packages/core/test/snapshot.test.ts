import { $ } from "bun"
import { describe, expect } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { Deferred, Effect, Fiber, Layer } from "effect"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { Git } from "@opencode/core/git"
import { Global } from "@opencode/util/global"
import { Location } from "@opencode/core/location"
import { AbsolutePath, RelativePath } from "@opencode/core/schema"
import { Snapshot } from "@opencode/core/snapshot"
import { Hash } from "@opencode/util/hash"
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
            Location.node.replace(Layer.succeed(Location.Service, location)),
            Global.node.replace(Global.layerWith({ data: tmp.path, config: path.join(tmp.path, "config") })),
            Git.node.replace(Layer.succeed(Git.Service, instrumented)),
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

  testEffect(Layer.empty).live("recovers from a corrupt index and ignores a stale index lock", () =>
    Effect.acquireUseRelease(
      Effect.promise(() => tmpdir()),
      (tmp) =>
        Effect.gen(function* () {
          const project = path.join(tmp.path, "project")
          yield* Effect.promise(async () => {
            await fs.mkdir(project)
            await fs.writeFile(path.join(project, "tracked.txt"), "one\n")
            await initGit(project, true)
          })
          yield* Effect.gen(function* () {
            const snapshot = yield* Snapshot.Service
            const before = yield* snapshot.capture()
            const storage = yield* snapshotDirectory(tmp.path)
            yield* Effect.promise(async () => {
              // A process killed mid-write in older releases left a zeroed index and a lock behind.
              await fs.writeFile(path.join(storage, "index"), new Uint8Array(512))
              await fs.writeFile(path.join(storage, "index.lock"), "")
              await fs.writeFile(path.join(project, "tracked.txt"), "two\n")
            })
            const after = yield* snapshot.capture()
            expect(after).toBeDefined()
            if (!before || !after) return
            expect(yield* snapshot.files({ from: before, to: after })).toEqual([RelativePath.make("tracked.txt")])
          }).pipe(Effect.provide(snapshotLayer(tmp.path, project)))
        }),
      (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
    ),
  )

  testEffect(Layer.empty).live("captures concurrently from independent processes", () =>
    Effect.acquireUseRelease(
      Effect.promise(() => tmpdir()),
      (tmp) =>
        Effect.gen(function* () {
          const project = path.join(tmp.path, "project")
          yield* Effect.promise(async () => {
            await fs.mkdir(project)
            await Promise.all(
              Array.from({ length: 200 }, (_, index) =>
                fs.writeFile(path.join(project, `f${index}.txt`), `${index}\n`),
              ),
            )
            await initGit(project, true)
          })
          // Each layer owns its own Git service, so their in-process locks do not coordinate.
          const writer = (id: number) =>
            Effect.gen(function* () {
              const snapshot = yield* Snapshot.Service
              return yield* Effect.forEach(
                Array.from({ length: 8 }, (_, index) => index),
                (index) =>
                  Effect.promise(() => fs.writeFile(path.join(project, `writer-${id}.txt`), `${index}\n`)).pipe(
                    Effect.andThen(snapshot.capture()),
                  ),
              )
            }).pipe(Effect.provide(snapshotLayer(tmp.path, project)))
          const results = yield* Effect.all([writer(0), writer(1), writer(2)], { concurrency: "unbounded" })
          expect(results.flat().every((tree) => tree !== undefined)).toBe(true)
        }),
      (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
    ),
  )

  testEffect(Layer.empty).live("captures a Location in a directory whose name starts with two dots", () =>
    Effect.acquireUseRelease(
      Effect.promise(() => tmpdir()),
      (tmp) =>
        Effect.gen(function* () {
          const project = path.join(tmp.path, "project")
          const location = path.join(project, "..scope")
          yield* Effect.promise(async () => {
            await fs.mkdir(location, { recursive: true })
            await fs.writeFile(path.join(location, "tracked.txt"), "one\n")
            await initGit(project)
          })
          yield* Effect.gen(function* () {
            const snapshot = yield* Snapshot.Service
            const before = yield* snapshot.capture()
            yield* Effect.promise(() => fs.writeFile(path.join(location, "tracked.txt"), "two\n"))
            const after = yield* snapshot.capture()
            expect(before).toBeDefined()
            expect(after).toBeDefined()
            if (!before || !after) return
            expect(yield* snapshot.files({ from: before, to: after })).toEqual([
              RelativePath.make("..scope/tracked.txt"),
            ])
          }).pipe(Effect.provide(snapshotLayer(tmp.path, location)))
        }),
      (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
    ),
  )

  testEffect(Layer.empty).live("restores many files from several trees and removes paths absent from them", () =>
    Effect.acquireUseRelease(
      Effect.promise(() => tmpdir()),
      (tmp) =>
        Effect.gen(function* () {
          const project = path.join(tmp.path, "project")
          yield* Effect.promise(async () => {
            await fs.mkdir(project)
            await fs.writeFile(path.join(project, "a.txt"), "a1\n")
            await fs.writeFile(path.join(project, "b[1].txt"), "b1\n")
            await initGit(project, true)
          })
          yield* Effect.gen(function* () {
            const snapshot = yield* Snapshot.Service
            const first = yield* snapshot.capture()
            yield* Effect.promise(async () => {
              await fs.writeFile(path.join(project, "a.txt"), "a2\n")
              await fs.writeFile(path.join(project, "c.txt"), "c2\n")
            })
            const second = yield* snapshot.capture()
            yield* Effect.promise(async () => {
              await fs.writeFile(path.join(project, "a.txt"), "a3\n")
              await fs.writeFile(path.join(project, "b[1].txt"), "b3\n")
              await fs.writeFile(path.join(project, "c.txt"), "c3\n")
              await fs.writeFile(path.join(project, "d.txt"), "d3\n")
            })
            if (!first || !second) throw new globalThis.Error("capture failed")
            yield* snapshot.restore({
              files: new Map([
                [RelativePath.make("a.txt"), second],
                [RelativePath.make("b[1].txt"), first],
                [RelativePath.make("c.txt"), first],
                [RelativePath.make("d.txt"), second],
              ]),
            })
            expect(yield* read(path.join(project, "a.txt"))).toBe("a2\n")
            expect(yield* read(path.join(project, "b[1].txt"))).toBe("b1\n")
            expect(yield* exists(path.join(project, "c.txt"))).toBe(false)
            expect(yield* exists(path.join(project, "d.txt"))).toBe(false)
          }).pipe(Effect.provide(snapshotLayer(tmp.path, project)))
        }),
      (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
    ),
  )

  testEffect(Layer.empty).live("restores and diffs a selection too long for one command line", () =>
    Effect.acquireUseRelease(
      Effect.promise(() => tmpdir()),
      (tmp) =>
        Effect.gen(function* () {
          const project = path.join(tmp.path, "project")
          const names = Array.from({ length: 300 }, (_, index) => `deep/${"n".repeat(90)}-${index}.txt`)
          yield* Effect.promise(async () => {
            await fs.mkdir(path.join(project, "deep"), { recursive: true })
            await Promise.all(names.map((name) => fs.writeFile(path.join(project, name), "one\n")))
            await initGit(project, true)
          })
          yield* Effect.gen(function* () {
            const snapshot = yield* Snapshot.Service
            const first = yield* snapshot.capture()
            if (!first) throw new globalThis.Error("capture failed")
            yield* Effect.promise(() =>
              Promise.all(names.map((name) => fs.writeFile(path.join(project, name), "two\n"))),
            )
            const second = yield* snapshot.capture()
            if (!second) throw new globalThis.Error("capture failed")
            const diffs = yield* snapshot.diff({
              from: first,
              to: second,
              paths: names.map((name) => RelativePath.make(name)),
            })
            expect(diffs.map((diff) => diff.file).toSorted()).toEqual(names.toSorted())
            expect(
              diffs.every((diff) => diff.additions === 1 && diff.deletions === 1 && diff.patch.includes("+two")),
            ).toBe(true)
            yield* snapshot.restore({ files: new Map(names.map((name) => [RelativePath.make(name), first])) })
            const contents = yield* Effect.forEach(names, (name) => read(path.join(project, name)))
            expect(new Set(contents)).toEqual(new Set(["one\n"]))
          }).pipe(Effect.provide(snapshotLayer(tmp.path, project)))
        }),
      (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
    ),
  )

  testEffect(Layer.empty).live("restores the other files when removing one path fails", () =>
    Effect.acquireUseRelease(
      Effect.promise(() => tmpdir()),
      (tmp) =>
        Effect.gen(function* () {
          const project = path.join(tmp.path, "project")
          yield* Effect.promise(async () => {
            await fs.mkdir(project)
            await fs.writeFile(path.join(project, "c.txt"), "old\n")
            await initGit(project, true)
          })
          yield* Effect.gen(function* () {
            const snapshot = yield* Snapshot.Service
            const first = yield* snapshot.capture()
            if (!first) throw new globalThis.Error("capture failed")
            // Removing `a/b` fails on POSIX because `a` is now a file.
            yield* Effect.promise(async () => {
              await fs.writeFile(path.join(project, "c.txt"), "changed\n")
              await fs.writeFile(path.join(project, "a"), "file\n")
            })
            yield* snapshot
              .restore({
                files: new Map([
                  [RelativePath.make("a/b"), first],
                  [RelativePath.make("c.txt"), first],
                ]),
              })
              .pipe(Effect.exit)
            expect(yield* read(path.join(project, "c.txt"))).toBe("old\n")
          }).pipe(Effect.provide(snapshotLayer(tmp.path, project)))
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
            const registration = yield* snapshot.transform((editor) => editor.configure(false))
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
    Location.node.replace(Location.boundNode(Location.Ref.make({ directory: AbsolutePath.make(directory) }))),
    Global.node.replace(Global.layerWith({ data, config: path.join(data, "config") })),
  ])
}

function snapshotDirectory(data: string) {
  return Effect.promise(async () => {
    const projects = await fs.readdir(path.join(data, "snapshot"))
    const project = path.join(data, "snapshot", projects[0]!)
    return path.join(project, (await fs.readdir(project))[0]!)
  })
}

function exists(file: string) {
  return Effect.promise(() =>
    fs.stat(file).then(
      () => true,
      () => false,
    ),
  )
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
