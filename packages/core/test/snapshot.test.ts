import { $ } from "bun"
import { describe, expect } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { Deferred, Effect, Fiber, Layer } from "effect"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { Git } from "@opencode-ai/core/git"
import { Global } from "@opencode-ai/util/global"
import { Location } from "@opencode-ai/core/location"
import { AbsolutePath, RelativePath } from "@opencode-ai/core/schema"
import { Snapshot } from "@opencode-ai/core/snapshot"
import { Hash } from "@opencode-ai/util/hash"
import { tmpdir } from "./fixture/tmpdir"
import { testEffect } from "./lib/effect"

describe("Snapshot", () => {
  for (const reverse of [false, true]) {
    testEffect(Layer.empty).live(
      `restores symlink and directory round trips without escaping (reverse=${reverse})`,
      () =>
        Effect.acquireUseRelease(
          Effect.promise(() => tmpdir()),
          (tmp) =>
            Effect.gen(function* () {
              const project = path.join(tmp.path, "project")
              const external = path.join(tmp.path, "external")
              const assets = path.join(project, "assets")
              yield* Effect.promise(async () => {
                await fs.mkdir(project)
                await fs.mkdir(external)
                await Bun.write(path.join(external, "logo.svg"), "External content must survive.\n")
                await fs.symlink(external, assets, "dir")
                await initGit(project)
              })
              const index = yield* Effect.promise(() => Bun.file(path.join(project, ".git", "index")).bytes())
              yield* Effect.gen(function* () {
                const snapshot = yield* Snapshot.Service
                const before = yield* snapshot.capture()
                if (!before) throw new Error("Initial snapshot missing")
                yield* Effect.promise(async () => {
                  await fs.unlink(assets)
                  await fs.mkdir(assets)
                  await Bun.write(path.join(assets, "logo.svg"), "Project content.\n")
                })
                const after = yield* snapshot.capture()
                if (!after) throw new Error("Changed snapshot missing")
                const changed = yield* snapshot.files({ from: before, to: after })
                expect(changed).toEqual([RelativePath.make("assets"), RelativePath.make("assets/logo.svg")])
                const files = reverse ? changed.toReversed() : changed

                for (let attempt = 0; attempt < 2; attempt++) {
                  yield* snapshot.restore({ files: new Map(files.map((file) => [file, before])) })
                  expect(yield* Effect.promise(() => Bun.file(path.join(external, "logo.svg")).exists())).toBe(true)
                  expect(yield* read(path.join(external, "logo.svg"))).toBe("External content must survive.\n")
                  expect(yield* Effect.promise(() => fs.readlink(assets))).toBe(external)
                }

                for (let attempt = 0; attempt < 2; attempt++) {
                  yield* snapshot.restore({ files: new Map(files.map((file) => [file, after])) })
                  expect(yield* read(path.join(external, "logo.svg"))).toBe("External content must survive.\n")
                  expect(yield* Effect.promise(async () => (await fs.lstat(assets)).isDirectory())).toBe(true)
                  expect(yield* read(path.join(assets, "logo.svg"))).toBe("Project content.\n")
                }
                expect(yield* Effect.promise(() => Bun.file(path.join(project, ".git", "index")).bytes())).toEqual(
                  index,
                )
              }).pipe(Effect.provide(snapshotLayer(tmp.path, project)))
            }),
          (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
        ),
    )
  }

  for (const present of [false, true]) {
    testEffect(Layer.empty).live(`does not follow an existing external symlink (present=${present})`, () =>
      Effect.acquireUseRelease(
        Effect.promise(() => tmpdir()),
        (tmp) =>
          Effect.gen(function* () {
            const project = path.join(tmp.path, "project")
            const external = path.join(tmp.path, "external")
            const assets = path.join(project, "assets")
            yield* Effect.promise(async () => {
              await fs.mkdir(assets, { recursive: true })
              await fs.mkdir(external)
              await Bun.write(path.join(assets, "logo.svg"), "Project content.\n")
              await Bun.write(path.join(external, "logo.svg"), "External content must survive.\n")
              await initGit(project)
            })
            yield* Effect.gen(function* () {
              const snapshot = yield* Snapshot.Service
              const before = yield* snapshot.capture()
              if (!before) throw new Error("Initial snapshot missing")
              yield* Effect.promise(() => fs.unlink(path.join(assets, "logo.svg")))
              const after = yield* snapshot.capture()
              if (!after) throw new Error("Changed snapshot missing")
              yield* Effect.promise(async () => {
                await fs.rmdir(assets)
                await fs.symlink(external, assets, "dir")
              })

              const result = yield* snapshot
                .restore({ files: new Map([[RelativePath.make("assets/logo.svg"), present ? before : after]]) })
                .pipe(Effect.exit)
              expect(yield* Effect.promise(() => Bun.file(path.join(external, "logo.svg")).exists())).toBe(true)
              expect(yield* read(path.join(external, "logo.svg"))).toBe("External content must survive.\n")
              if (present) {
                yield* result
                expect(yield* read(path.join(assets, "logo.svg"))).toBe("Project content.\n")
                expect(yield* Effect.promise(async () => (await fs.lstat(assets)).isDirectory())).toBe(true)
                return
              }
              const error = yield* result.pipe(Effect.flip)
              expect(error).toBeInstanceOf(Snapshot.Error)
              expect(error).toMatchObject({
                operation: "restore",
                message: "Path escapes the project: assets/logo.svg",
              })
              expect(yield* Effect.promise(() => fs.readlink(assets))).toBe(external)
            }).pipe(Effect.provide(snapshotLayer(tmp.path, project)))
          }),
        (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
      ),
    )
  }

  testEffect(Layer.empty).live("uses the closest restored ancestor for mixed-tree deletions", () =>
    Effect.acquireUseRelease(
      Effect.promise(() => tmpdir()),
      (tmp) =>
        Effect.gen(function* () {
          const project = path.join(tmp.path, "project")
          const external = path.join(tmp.path, "external")
          const assets = path.join(project, "assets")
          yield* Effect.promise(async () => {
            await fs.mkdir(project)
            await fs.mkdir(external)
            await Bun.write(path.join(external, "logo.svg"), "External content must survive.\n")
            await fs.symlink(external, assets, "dir")
            await initGit(project)
          })
          yield* Effect.gen(function* () {
            const snapshot = yield* Snapshot.Service
            const link = yield* snapshot.capture()
            if (!link) throw new Error("Symlink snapshot missing")
            yield* Effect.promise(async () => {
              await fs.unlink(assets)
              await fs.mkdir(path.join(assets, "nested"), { recursive: true })
              await Bun.write(path.join(assets, "nested", "logo.svg"), "Project content.\n")
            })
            const directory = yield* snapshot.capture()
            if (!directory) throw new Error("Directory snapshot missing")
            yield* Effect.promise(() => fs.unlink(path.join(assets, "nested", "logo.svg")))
            const removed = yield* snapshot.capture()
            if (!removed) throw new Error("Removed-file snapshot missing")

            yield* snapshot.restore({
              files: new Map([
                [RelativePath.make("assets/nested/logo.svg"), removed],
                [RelativePath.make("assets/nested"), directory],
                [RelativePath.make("assets"), link],
              ]),
            })
            expect(yield* Effect.promise(async () => (await fs.lstat(path.join(assets, "nested"))).isDirectory())).toBe(
              true,
            )
            expect(yield* Effect.promise(() => Bun.file(path.join(assets, "nested", "logo.svg")).exists())).toBe(false)
            expect(yield* read(path.join(external, "logo.svg"))).toBe("External content must survive.\n")
          }).pipe(Effect.provide(snapshotLayer(tmp.path, project)))
        }),
      (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
    ),
  )

  testEffect(Layer.empty).live("checks symlink ignore rules without hiding fatal Git errors", () =>
    Effect.acquireUseRelease(
      Effect.promise(() => tmpdir()),
      (tmp) =>
        Effect.gen(function* () {
          const project = path.join(tmp.path, "project")
          const external = path.join(tmp.path, "external")
          const assets = path.join(project, "assets")
          yield* Effect.promise(async () => {
            await fs.mkdir(project)
            await fs.mkdir(external)
            await fs.symlink(external, assets, "dir")
            await initGit(project)
          })
          yield* Effect.gen(function* () {
            const snapshot = yield* Snapshot.Service
            const before = yield* snapshot.capture()
            if (!before) throw new Error("Initial snapshot missing")
            yield* Effect.promise(async () => {
              await fs.unlink(assets)
              await fs.mkdir(assets)
              await Bun.write(path.join(assets, "logo.svg"), "Project content.\n")
            })
            const after = yield* snapshot.capture()
            if (!after) throw new Error("Directory snapshot missing")
            yield* snapshot.restore({
              files: new Map([
                [RelativePath.make("assets"), before],
                [RelativePath.make("assets/logo.svg"), before],
              ]),
            })
            expect(yield* snapshot.files({ from: after, to: before })).toEqual([
              RelativePath.make("assets"),
              RelativePath.make("assets/logo.svg"),
            ])
            yield* Effect.promise(() => Bun.write(path.join(project, ".gitignore"), "assets\n"))
            expect(yield* snapshot.files({ from: after, to: before })).toEqual([])
            yield* Effect.promise(() => Bun.write(path.join(project, ".git", "config"), "[broken\n"))
            const error = yield* snapshot.files({ from: after, to: before }).pipe(Effect.flip)
            expect(error).toBeInstanceOf(Snapshot.Error)
            expect(error.operation).toBe("files")
            expect(error.message).toContain("bad config line")
          }).pipe(Effect.provide(snapshotLayer(tmp.path, project)))
        }),
      (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
    ),
  )

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

  testEffect(Layer.empty).live("treats fatal ignore checks as unavailable captures", () =>
    Effect.acquireUseRelease(
      Effect.promise(() => tmpdir()),
      (tmp) =>
        Effect.gen(function* () {
          const project = path.join(tmp.path, "project")
          yield* Effect.promise(async () => {
            await fs.mkdir(project)
            await Bun.write(path.join(project, "tracked.txt"), "one\n")
            await initGit(project)
          })
          yield* Effect.gen(function* () {
            const snapshot = yield* Snapshot.Service
            expect(yield* snapshot.capture()).toBeDefined()
            yield* Effect.promise(async () => {
              await Bun.write(path.join(project, "tracked.txt"), "two\n")
              await Bun.write(path.join(project, ".git", "config"), "[broken\n")
            })
            expect(yield* snapshot.capture()).toBeUndefined()
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

function read(file: string) {
  return Effect.promise(() => fs.readFile(file, "utf8")).pipe(Effect.map((content) => content.replaceAll("\r\n", "\n")))
}

async function initGit(directory: string, commit = false) {
  await $`git init`.cwd(directory).quiet()
  await $`git -c core.fsmonitor=false add .`.cwd(directory).quiet()
  if (!commit) return
  await $`git -c user.email=test@opencode.test -c user.name=Test commit --no-gpg-sign -m initial`.cwd(directory).quiet()
}
