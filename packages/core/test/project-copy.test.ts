import { describe, expect } from "bun:test"
import { $ } from "bun"
import fs from "fs/promises"
import path from "path"
import { eq } from "drizzle-orm"
import { Effect, Fiber, Layer, Stream } from "effect"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { Git } from "@opencode-ai/core/git"
import { Database } from "@opencode-ai/core/database/database"
import { EventV2 } from "@opencode-ai/core/event"
import { Project } from "@opencode-ai/core/project"
import { ProjectDirectoryTable, ProjectTable } from "@opencode-ai/core/project/sql"
import { ProjectCopy } from "@opencode-ai/core/project/copy"
import { ProjectDirectories } from "@opencode-ai/core/project/directories"
import { tmpdir } from "./fixture/tmpdir"
import { testEffect } from "./lib/effect"

const databaseLayer = Database.layerFromPath(":memory:")
const eventLayer = EventV2.layer.pipe(Layer.provide(databaseLayer))
const directoriesLayer = ProjectDirectories.layer.pipe(Layer.provide(databaseLayer))
const copyLayer = ProjectCopy.layer.pipe(
  Layer.provide(databaseLayer),
  Layer.provide(directoriesLayer),
  Layer.provide(eventLayer),
  Layer.provide(FSUtil.defaultLayer),
  Layer.provide(Git.defaultLayer),
)
const it = testEffect(Layer.mergeAll(copyLayer, databaseLayer, eventLayer, directoriesLayer))

function abs(input: string) {
  return AbsolutePath.make(input)
}

const gitWorktree = ProjectCopy.StrategyID.make("git_worktree")

async function initRepo(directory: string) {
  await $`git init`.cwd(directory).quiet()
  await $`git config core.fsmonitor false`.cwd(directory).quiet()
  await $`git config commit.gpgsign false`.cwd(directory).quiet()
  await $`git config user.email test@opencode.test`.cwd(directory).quiet()
  await $`git config user.name Test`.cwd(directory).quiet()
  await $`git commit --allow-empty -m root`.cwd(directory).quiet()
}

function setup() {
  return Effect.gen(function* () {
    const root = yield* Effect.acquireRelease(
      Effect.promise(() => tmpdir()),
      (dir) => Effect.promise(() => dir[Symbol.asyncDispose]()),
    )
    yield* Effect.promise(() => initRepo(root.path))
    const sourceDirectory = abs(yield* Effect.promise(() => fs.realpath(root.path)))
    const projectID = Project.ID.make("copy-project")
    const { db } = yield* Database.Service
    yield* db
      .insert(ProjectTable)
      .values({ id: projectID, worktree: sourceDirectory, sandboxes: [], time_created: 1, time_updated: 1 })
      .run()
      .pipe(Effect.orDie)
    yield* db
      .insert(ProjectDirectoryTable)
      .values({ project_id: projectID, directory: sourceDirectory })
      .run()
      .pipe(Effect.orDie)
    return { root, sourceDirectory, projectID, db }
  })
}

function stored(projectID: Project.ID) {
  return Database.Service.use(({ db }) =>
    db
      .select({ directory: ProjectDirectoryTable.directory, strategy: ProjectDirectoryTable.strategy })
      .from(ProjectDirectoryTable)
      .where(eq(ProjectDirectoryTable.project_id, projectID))
      .all()
      .pipe(
        Effect.orDie,
        Effect.map((rows) => rows.toSorted((a, b) => a.directory.localeCompare(b.directory))),
      ),
  )
}

describe("ProjectCopy", () => {
  it.effect("accepts arbitrary non-empty strategy ids", () =>
    Effect.sync(() => {
      expect(String(ProjectCopy.StrategyID.make("acme/snapshot"))).toBe("acme/snapshot")
      expect(() => ProjectCopy.StrategyID.make("  acme/snapshot  ")).toThrow()
      expect(() => ProjectCopy.StrategyID.make("   ")).toThrow()
    }),
  )

  it.effect("rejects duplicate strategies and reports unavailable ids", () =>
    Effect.gen(function* () {
      const input = yield* setup()
      const copy = yield* ProjectCopy.Service
      const strategy: ProjectCopy.Strategy = {
        id: ProjectCopy.StrategyID.make("test/duplicate"),
        create: () => Effect.die("unused"),
        remove: () => Effect.die("unused"),
        list: () => Effect.succeed([]),
      }

      yield* copy.register(strategy)
      expect(yield* copy.register(strategy).pipe(Effect.flip)).toBeInstanceOf(ProjectCopy.DuplicateStrategyError)

      const unavailable = ProjectCopy.StrategyID.make("acme/missing")
      const error = yield* copy
        .create({
          projectID: input.projectID,
          strategy: unavailable,
          sourceDirectory: input.sourceDirectory,
          directory: abs(`${input.root.path}-missing-strategy`),
          name: "copy",
        })
        .pipe(Effect.flip)
      expect(error).toBeInstanceOf(ProjectCopy.StrategyUnavailableError)
      if (error instanceof ProjectCopy.StrategyUnavailableError) expect(error.strategy).toBe(unavailable)
    }),
  )

  it.live("creates and removes a git worktree directory", () =>
    Effect.gen(function* () {
      const input = yield* setup()
      const copy = yield* ProjectCopy.Service
      const events = yield* EventV2.Service
      const temp = yield* Effect.promise(() => fs.realpath(path.dirname(input.root.path)))
      const parent = abs(path.join(temp, path.basename(input.root.path) + "-copy-created"))
      const target = abs(path.join(parent, "copy"))
      yield* Effect.addFinalizer(() =>
        Effect.promise(() => fs.rm(parent, { recursive: true, force: true })).pipe(Effect.ignore),
      )
      const fiber = yield* events
        .subscribe(ProjectCopy.Event.Updated)
        .pipe(Stream.take(1), Stream.runCollect, Effect.forkScoped)
      yield* Effect.yieldNow

      const created = yield* copy.create({
        projectID: input.projectID,
        strategy: gitWorktree,
        sourceDirectory: input.sourceDirectory,
        directory: parent,
        name: "copy",
      })
      expect(created.directory).toBe(target)
      expect(yield* stored(input.projectID)).toEqual(
        [
          { directory: input.sourceDirectory, strategy: null },
          { directory: created.directory, strategy: "git_worktree" },
        ].toSorted((a, b) => a.directory.localeCompare(b.directory)),
      )
      expect(Array.from(yield* Fiber.join(fiber))[0]?.data).toEqual({ projectID: input.projectID })

      yield* copy.remove({ projectID: input.projectID, directory: created.directory, force: false })

      expect(yield* stored(input.projectID)).toEqual([{ directory: input.sourceDirectory, strategy: null }])
      expect(yield* Effect.promise(() => Bun.file(target).exists())).toBe(false)
    }),
  )

  it.live("requires force to remove a dirty git worktree", () =>
    Effect.gen(function* () {
      const input = yield* setup()
      const copy = yield* ProjectCopy.Service
      const temp = yield* Effect.promise(() => fs.realpath(path.dirname(input.root.path)))
      const parent = abs(path.join(temp, path.basename(input.root.path) + "-copy-dirty"))
      yield* Effect.addFinalizer(() =>
        Effect.promise(() => fs.rm(parent, { recursive: true, force: true })).pipe(Effect.ignore),
      )
      const created = yield* copy.create({
        projectID: input.projectID,
        strategy: gitWorktree,
        sourceDirectory: input.sourceDirectory,
        directory: parent,
        name: "copy",
      })
      yield* Effect.promise(() => Bun.write(path.join(created.directory, "dirty.txt"), "dirty"))

      const error = yield* copy
        .remove({ projectID: input.projectID, directory: created.directory, force: false })
        .pipe(Effect.flip)

      expect(error).toBeInstanceOf(Git.WorktreeError)
      if (error instanceof Git.WorktreeError) {
        expect(error.operation).toBe("remove")
        expect(error.forceRequired).toBe(true)
      }
      expect(yield* stored(input.projectID)).toContainEqual({ directory: created.directory, strategy: "git_worktree" })
      expect(yield* Effect.promise(() => Bun.file(path.join(created.directory, "dirty.txt")).exists())).toBe(true)

      yield* copy.remove({ projectID: input.projectID, directory: created.directory, force: true })
      expect(yield* Effect.promise(() => Bun.file(created.directory).exists())).toBe(false)
    }),
  )

  it.live("preserves copies whose stored strategy is unavailable", () =>
    Effect.gen(function* () {
      const input = yield* setup()
      const copy = yield* ProjectCopy.Service
      const unavailable = abs(`${input.root.path}-copy-unavailable`)
      yield* Effect.promise(() => fs.mkdir(unavailable))
      yield* Effect.addFinalizer(() => Effect.promise(() => fs.rm(unavailable, { recursive: true, force: true })))
      yield* input.db
        .insert(ProjectDirectoryTable)
        .values({ project_id: input.projectID, directory: unavailable, strategy: "acme/missing" })
        .run()
        .pipe(Effect.orDie)

      const error = yield* copy
        .remove({ projectID: input.projectID, directory: unavailable, force: false })
        .pipe(Effect.flip)

      expect(error).toBeInstanceOf(ProjectCopy.StrategyUnavailableError)
      expect(yield* stored(input.projectID)).toContainEqual({ directory: unavailable, strategy: "acme/missing" })
    }),
  )

  it.live("adds a numeric suffix when a copy directory already exists", () =>
    Effect.gen(function* () {
      const input = yield* setup()
      const copy = yield* ProjectCopy.Service
      const temp = yield* Effect.promise(() => fs.realpath(path.dirname(input.root.path)))
      const parent = abs(path.join(temp, path.basename(input.root.path) + "-copy-suffix"))
      const target = abs(path.join(parent, "copy-3"))
      yield* Effect.addFinalizer(() =>
        Effect.promise(() => fs.rm(parent, { recursive: true, force: true })).pipe(Effect.ignore),
      )
      yield* Effect.promise(() => fs.mkdir(path.join(parent, "copy"), { recursive: true }))
      yield* Effect.promise(() => fs.mkdir(path.join(parent, "copy-2")))

      const created = yield* copy.create({
        projectID: input.projectID,
        strategy: gitWorktree,
        sourceDirectory: input.sourceDirectory,
        directory: parent,
        name: "copy",
      })

      expect(created.directory).toBe(target)
      expect(yield* Effect.promise(() => fs.stat(path.join(parent, "copy")).then((item) => item.isDirectory()))).toBe(
        true,
      )
      expect(yield* Effect.promise(() => fs.stat(path.join(parent, "copy-2")).then((item) => item.isDirectory()))).toBe(
        true,
      )

      yield* copy.remove({ projectID: input.projectID, directory: created.directory, force: false })
    }),
  )

  it.live("fails after ten copy directory conflicts", () =>
    Effect.gen(function* () {
      const input = yield* setup()
      const copy = yield* ProjectCopy.Service
      const temp = yield* Effect.promise(() => fs.realpath(path.dirname(input.root.path)))
      const parent = abs(path.join(temp, path.basename(input.root.path) + "-copy-conflicts"))
      yield* Effect.addFinalizer(() =>
        Effect.promise(() => fs.rm(parent, { recursive: true, force: true })).pipe(Effect.ignore),
      )
      yield* Effect.promise(() =>
        Promise.all(
          Array.from({ length: 10 }, (_, index) =>
            fs.mkdir(path.join(parent, index === 0 ? "copy" : `copy-${index + 1}`), { recursive: true }),
          ),
        ),
      )

      const error = yield* copy
        .create({
          projectID: input.projectID,
          strategy: gitWorktree,
          sourceDirectory: input.sourceDirectory,
          directory: parent,
          name: "copy",
        })
        .pipe(Effect.flip)

      expect(error).toBeInstanceOf(ProjectCopy.DestinationExistsError)
      if (error instanceof ProjectCopy.DestinationExistsError)
        expect(error.directory).toBe(abs(path.join(parent, "copy-10")))
    }),
  )

  it.live("does not publish an event when refresh finds no directory changes", () =>
    Effect.gen(function* () {
      const input = yield* setup()
      const copy = yield* ProjectCopy.Service
      const events = yield* EventV2.Service
      const event = yield* events.subscribe(ProjectCopy.Event.Updated).pipe(
        Stream.take(1),
        Stream.runCollect,
        Effect.forkScoped,
        Effect.flatMap((fiber) =>
          Effect.gen(function* () {
            yield* Effect.yieldNow
            yield* copy.refresh({ projectID: input.projectID })
            return yield* Fiber.join(fiber).pipe(Effect.timeoutOption("50 millis"))
          }),
        ),
      )

      expect(event._tag).toBe("None")
    }),
  )

  it.live("refresh discovers and prunes an externally managed git worktree", () =>
    Effect.gen(function* () {
      const input = yield* setup()
      const copy = yield* ProjectCopy.Service
      const events = yield* EventV2.Service
      const target = abs(`${input.root.path}-copy-external`)
      yield* Effect.addFinalizer(() =>
        Effect.promise(() => fs.rm(target, { recursive: true, force: true })).pipe(Effect.ignore),
      )
      yield* Effect.promise(() => $`git worktree add --detach ${target} HEAD`.cwd(input.root.path).quiet())
      yield* input.db
        .insert(ProjectDirectoryTable)
        .values({ project_id: input.projectID, directory: target })
        .run()
        .pipe(Effect.orDie)
      const fiber = yield* events
        .subscribe(ProjectCopy.Event.Updated)
        .pipe(Stream.take(1), Stream.runCollect, Effect.forkScoped)
      yield* Effect.yieldNow

      const discovered = abs(yield* Effect.promise(() => fs.realpath(target)))
      expect(yield* copy.refresh({ projectID: input.projectID })).toEqual({ updated: [discovered], removed: [] })

      expect(yield* stored(input.projectID)).toEqual(
        [
          { directory: input.sourceDirectory, strategy: null },
          { directory: discovered, strategy: "git_worktree" },
        ].toSorted((a, b) => a.directory.localeCompare(b.directory)),
      )
      expect(Array.from(yield* Fiber.join(fiber))[0]?.data).toEqual({ projectID: input.projectID })

      yield* Effect.promise(() => $`git worktree remove --force ${target}`.cwd(input.root.path).quiet())
      expect(yield* copy.refresh({ projectID: input.projectID })).toEqual({ updated: [], removed: [discovered] })
      expect(yield* stored(input.projectID)).toEqual([{ directory: input.sourceDirectory, strategy: null }])
    }),
  )

  it.live("refresh ignores stale git worktree registrations", () =>
    Effect.gen(function* () {
      const input = yield* setup()
      const copy = yield* ProjectCopy.Service
      const stale = abs(`${input.root.path}-copy-stale`)
      const target = abs(`${input.root.path}-copy-after-stale`)
      yield* Effect.addFinalizer(() =>
        Effect.promise(() => fs.rm(target, { recursive: true, force: true })).pipe(Effect.ignore),
      )
      yield* Effect.promise(() => $`git worktree add --detach ${stale} HEAD`.cwd(input.root.path).quiet())
      yield* Effect.promise(() => fs.rm(stale, { recursive: true, force: true }))
      yield* Effect.promise(() => $`git worktree add --detach ${target} HEAD`.cwd(input.root.path).quiet())

      yield* copy.refresh({ projectID: input.projectID })

      const discovered = abs(yield* Effect.promise(() => fs.realpath(target)))
      expect(yield* stored(input.projectID)).toEqual(
        [
          { directory: input.sourceDirectory, strategy: null },
          { directory: discovered, strategy: "git_worktree" },
        ].toSorted((a, b) => a.directory.localeCompare(b.directory)),
      )
    }),
  )

  it.live("refresh with no roots is a no-op", () =>
    Effect.gen(function* () {
      const copy = yield* ProjectCopy.Service

      expect(yield* copy.refresh({ projectID: Project.ID.make("missing-project") })).toEqual({
        updated: [],
        removed: [],
      })
    }),
  )

  it.live("refresh removes missing ordinary checkouts", () =>
    Effect.gen(function* () {
      const input = yield* setup()
      const missing = abs(`${input.root.path}-missing-checkout`)
      yield* input.db
        .insert(ProjectDirectoryTable)
        .values({ project_id: input.projectID, directory: missing })
        .run()
        .pipe(Effect.orDie)
      const copy = yield* ProjectCopy.Service

      expect(yield* copy.refresh({ projectID: input.projectID })).toEqual({ updated: [], removed: [missing] })

      expect(yield* stored(input.projectID)).not.toContainEqual({ directory: missing, strategy: null })
    }),
  )
})
