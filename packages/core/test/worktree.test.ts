import { describe, expect } from "bun:test"
import { $ } from "bun"
import fs from "fs/promises"
import path from "path"
import { and, eq, isNull } from "drizzle-orm"
import { Effect, Fiber, Stream } from "effect"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/util/effect/layer-node"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { Git } from "@opencode-ai/core/git"
import { Database } from "@opencode-ai/core/database/database"
import { Bus } from "@opencode-ai/core/bus"
import { Project } from "@opencode-ai/core/project"
import { ProjectTable } from "@opencode-ai/core/project/sql"
import { Worktree } from "@opencode-ai/core/worktree"
import { WorktreeDirectory } from "@opencode-ai/core/worktree/directory"
import { WorktreeTable } from "@opencode-ai/core/worktree/sql"
import { tmpdir } from "./fixture/tmpdir"
import { testEffect } from "./lib/effect"

const it = testEffect(AppNodeBuilder.build(LayerNode.group([Worktree.node, Database.node, Bus.node])))
const projectIt = testEffect(
  AppNodeBuilder.build(LayerNode.group([Project.node, Worktree.node, Database.node, Bus.node])),
)

function abs(input: string) {
  return AbsolutePath.make(input)
}

const gitWorktree = Worktree.StrategyID.make("git")

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
    const projectID = Project.ID.make("worktree-project")
    const { db } = yield* Database.Service
    yield* db
      .insert(ProjectTable)
      .values({ id: projectID, worktree: sourceDirectory, sandboxes: [], time_created: 1, time_updated: 1 })
      .run()
      .pipe(Effect.orDie)
    yield* db
      .insert(WorktreeTable)
      .values({ project_id: projectID, directory: sourceDirectory })
      .run()
      .pipe(Effect.orDie)
    return { root, sourceDirectory, projectID, db }
  })
}

function stored(projectID: Project.ID) {
  return Database.Service.use(({ db }) =>
    db
      .select({ directory: WorktreeTable.directory, strategy: WorktreeTable.strategy })
      .from(WorktreeTable)
      .where(eq(WorktreeTable.project_id, projectID))
      .all()
      .pipe(
        Effect.orDie,
        Effect.map((rows) => rows.toSorted((a, b) => a.directory.localeCompare(b.directory))),
      ),
  )
}

describe("Worktree", () => {
  projectIt.live("tracks canonical and linked worktrees when a project resolves", () =>
    Effect.gen(function* () {
      const root = yield* Effect.acquireRelease(
        Effect.promise(() => tmpdir()),
        (dir) => Effect.promise(() => dir[Symbol.asyncDispose]()),
      )
      yield* Effect.promise(() => initRepo(root.path))
      const linked = `${root.path}-linked`
      yield* Effect.addFinalizer(() =>
        Effect.promise(() => fs.rm(linked, { recursive: true, force: true })).pipe(Effect.ignore),
      )
      yield* Effect.promise(() => $`git worktree add ${linked} -b linked-${Date.now()}`.cwd(root.path).quiet())
      const project = yield* Project.Service

      const resolved = yield* project.resolve(abs(linked))

      expect(yield* stored(resolved.id)).toEqual(
        [
          { directory: abs(yield* Effect.promise(() => fs.realpath(root.path))), strategy: null },
          { directory: abs(yield* Effect.promise(() => fs.realpath(linked))), strategy: "git" },
        ].toSorted((a, b) => a.directory.localeCompare(b.directory)),
      )
    }),
  )

  it.effect("accepts arbitrary non-empty strategy ids", () =>
    Effect.sync(() => {
      expect(String(Worktree.StrategyID.make("acme/snapshot"))).toBe("acme/snapshot")
      expect(() => Worktree.StrategyID.make("  acme/snapshot  ")).toThrow()
      expect(() => Worktree.StrategyID.make("   ")).toThrow()
    }),
  )

  it.effect("reports unavailable strategy ids", () =>
    Effect.gen(function* () {
      const input = yield* setup()
      const worktree = yield* Worktree.Service
      const unavailable = Worktree.StrategyID.make("acme/missing")
      const error = yield* worktree
        .create({
          projectID: input.projectID,
          strategy: unavailable,
          from: input.sourceDirectory,
          directory: abs(`${input.root.path}-missing-strategy`),
          name: "worktree",
        })
        .pipe(Effect.flip)
      expect(error).toBeInstanceOf(Worktree.StrategyUnavailableError)
      if (error instanceof Worktree.StrategyUnavailableError) expect(error.strategy).toBe(unavailable)
    }),
  )

  it.live("requires a tracked project worktree", () =>
    Effect.gen(function* () {
      const input = yield* setup()
      yield* input.db
        .delete(WorktreeTable)
        .where(eq(WorktreeTable.project_id, input.projectID))
        .run()
        .pipe(Effect.orDie)
      const worktree = yield* Worktree.Service

      const error = yield* worktree
        .create({
          projectID: input.projectID,
          strategy: gitWorktree,
          from: input.sourceDirectory,
          directory: abs(`${input.root.path}-missing-source`),
          name: "worktree",
        })
        .pipe(Effect.flip)

      expect(error).toBeInstanceOf(Worktree.SourceDirectoryNotFoundError)
      if (error instanceof Worktree.SourceDirectoryNotFoundError) expect(error.directory).toBe(input.sourceDirectory)
    }),
  )

  it.live("creates and removes a git worktree directory", () =>
    Effect.gen(function* () {
      const input = yield* setup()
      const worktree = yield* Worktree.Service
      const bus = yield* Bus.Service
      const temp = yield* Effect.promise(() => fs.realpath(path.dirname(input.root.path)))
      const parent = abs(path.join(temp, path.basename(input.root.path) + "-worktree-created"))
      const target = abs(path.join(parent, "worktree"))
      yield* Effect.addFinalizer(() =>
        Effect.promise(() => fs.rm(parent, { recursive: true, force: true })).pipe(Effect.ignore),
      )
      const fiber = yield* bus
        .subscribe(Worktree.Event.Updated)
        .pipe(Stream.take(1), Stream.runCollect, Effect.forkScoped)
      yield* Effect.yieldNow

      const created = yield* worktree.create({
        projectID: input.projectID,
        strategy: gitWorktree,
        directory: parent,
        name: "worktree",
      })
      expect(created.directory).toBe(target)
      expect(yield* stored(input.projectID)).toEqual(
        [
          { directory: input.sourceDirectory, strategy: null },
          { directory: created.directory, strategy: "git" },
        ].toSorted((a, b) => a.directory.localeCompare(b.directory)),
      )
      expect(Array.from(yield* Fiber.join(fiber))[0]?.data).toEqual({ projectID: input.projectID })

      yield* worktree.remove({ projectID: input.projectID, directory: created.directory, force: false })

      expect(yield* stored(input.projectID)).toEqual([{ directory: input.sourceDirectory, strategy: null }])
      expect(yield* Effect.promise(() => Bun.file(target).exists())).toBe(false)
    }),
  )

  it.live("rejects a missing source directory", () =>
    Effect.gen(function* () {
      const input = yield* setup()
      const worktree = yield* Worktree.Service
      const temp = yield* Effect.promise(() => fs.realpath(path.dirname(input.root.path)))

      const error = yield* worktree
        .create({
          projectID: input.projectID,
          strategy: gitWorktree,
          from: abs(path.join(temp, "does-not-exist")),
          directory: abs(`${input.root.path}-missing-directory`),
          name: "worktree",
        })
        .pipe(Effect.flip)

      expect(error).toBeInstanceOf(WorktreeDirectory.DirectoryUnavailableError)
    }),
  )

  it.live("creates from another managed worktree", () =>
    Effect.gen(function* () {
      const input = yield* setup()
      const worktree = yield* Worktree.Service
      const temp = yield* Effect.promise(() => fs.realpath(path.dirname(input.root.path)))
      const sourceParent = abs(path.join(temp, path.basename(input.root.path) + "-managed-source"))
      const targetParent = abs(path.join(temp, path.basename(input.root.path) + "-managed-target"))
      yield* Effect.addFinalizer(() =>
        Effect.all([
          Effect.promise(() => fs.rm(sourceParent, { recursive: true, force: true })).pipe(Effect.ignore),
          Effect.promise(() => fs.rm(targetParent, { recursive: true, force: true })).pipe(Effect.ignore),
        ]).pipe(Effect.asVoid),
      )
      const source = yield* worktree.create({
        projectID: input.projectID,
        strategy: gitWorktree,
        from: input.sourceDirectory,
        directory: sourceParent,
        name: "source",
      })
      yield* input.db
        .delete(WorktreeTable)
        .where(and(eq(WorktreeTable.project_id, input.projectID), isNull(WorktreeTable.strategy)))
        .run()
        .pipe(Effect.orDie)

      const created = yield* worktree.create({
        projectID: input.projectID,
        strategy: gitWorktree,
        from: source.directory,
        directory: targetParent,
        name: "target",
      })

      expect(created.directory).toBe(abs(path.join(targetParent, "target")))
      yield* worktree.remove({ projectID: input.projectID, directory: created.directory, force: false })
      yield* worktree.remove({ projectID: input.projectID, directory: source.directory, force: false })
    }),
  )

  it.live("requires force to remove a dirty git worktree", () =>
    Effect.gen(function* () {
      const input = yield* setup()
      const worktree = yield* Worktree.Service
      const temp = yield* Effect.promise(() => fs.realpath(path.dirname(input.root.path)))
      const parent = abs(path.join(temp, path.basename(input.root.path) + "-worktree-dirty"))
      yield* Effect.addFinalizer(() =>
        Effect.promise(() => fs.rm(parent, { recursive: true, force: true })).pipe(Effect.ignore),
      )
      const created = yield* worktree.create({
        projectID: input.projectID,
        strategy: gitWorktree,
        from: input.sourceDirectory,
        directory: parent,
        name: "worktree",
      })
      yield* Effect.promise(() => Bun.write(path.join(created.directory, "dirty.txt"), "dirty"))

      const error = yield* worktree
        .remove({ projectID: input.projectID, directory: created.directory, force: false })
        .pipe(Effect.flip)

      expect(error).toBeInstanceOf(Git.WorktreeError)
      if (error instanceof Git.WorktreeError) {
        expect(error.operation).toBe("remove")
        expect(error.forceRequired).toBe(true)
      }
      expect(yield* stored(input.projectID)).toContainEqual({ directory: created.directory, strategy: "git" })
      expect(yield* Effect.promise(() => Bun.file(path.join(created.directory, "dirty.txt")).exists())).toBe(true)

      yield* worktree.remove({ projectID: input.projectID, directory: created.directory, force: true })
      expect(yield* Effect.promise(() => Bun.file(created.directory).exists())).toBe(false)
    }),
  )

  it.live("preserves worktrees whose stored strategy is unavailable", () =>
    Effect.gen(function* () {
      const input = yield* setup()
      const worktree = yield* Worktree.Service
      const unavailable = abs(`${input.root.path}-worktree-unavailable`)
      yield* Effect.promise(() => fs.mkdir(unavailable))
      yield* Effect.addFinalizer(() => Effect.promise(() => fs.rm(unavailable, { recursive: true, force: true })))
      yield* input.db
        .insert(WorktreeTable)
        .values({ project_id: input.projectID, directory: unavailable, strategy: "acme/missing" })
        .run()
        .pipe(Effect.orDie)

      const error = yield* worktree
        .remove({ projectID: input.projectID, directory: unavailable, force: false })
        .pipe(Effect.flip)

      expect(error).toBeInstanceOf(Worktree.StrategyUnavailableError)
      expect(yield* stored(input.projectID)).toContainEqual({ directory: unavailable, strategy: "acme/missing" })
    }),
  )

  it.live("adds a numeric suffix when a worktree directory already exists", () =>
    Effect.gen(function* () {
      const input = yield* setup()
      const worktree = yield* Worktree.Service
      const temp = yield* Effect.promise(() => fs.realpath(path.dirname(input.root.path)))
      const parent = abs(path.join(temp, path.basename(input.root.path) + "-worktree-suffix"))
      const target = abs(path.join(parent, "worktree-3"))
      yield* Effect.addFinalizer(() =>
        Effect.promise(() => fs.rm(parent, { recursive: true, force: true })).pipe(Effect.ignore),
      )
      yield* Effect.promise(() => fs.mkdir(path.join(parent, "worktree"), { recursive: true }))
      yield* Effect.promise(() => fs.mkdir(path.join(parent, "worktree-2")))

      const created = yield* worktree.create({
        projectID: input.projectID,
        strategy: gitWorktree,
        from: input.sourceDirectory,
        directory: parent,
        name: "worktree",
      })

      expect(created.directory).toBe(target)
      expect(
        yield* Effect.promise(() => fs.stat(path.join(parent, "worktree")).then((item) => item.isDirectory())),
      ).toBe(true)
      expect(
        yield* Effect.promise(() => fs.stat(path.join(parent, "worktree-2")).then((item) => item.isDirectory())),
      ).toBe(true)

      yield* worktree.remove({ projectID: input.projectID, directory: created.directory, force: false })
    }),
  )

  it.live("fails after ten worktree directory conflicts", () =>
    Effect.gen(function* () {
      const input = yield* setup()
      const worktree = yield* Worktree.Service
      const temp = yield* Effect.promise(() => fs.realpath(path.dirname(input.root.path)))
      const parent = abs(path.join(temp, path.basename(input.root.path) + "-worktree-conflicts"))
      yield* Effect.addFinalizer(() =>
        Effect.promise(() => fs.rm(parent, { recursive: true, force: true })).pipe(Effect.ignore),
      )
      yield* Effect.promise(() =>
        Promise.all(
          Array.from({ length: 10 }, (_, index) =>
            fs.mkdir(path.join(parent, index === 0 ? "worktree" : `worktree-${index + 1}`), { recursive: true }),
          ),
        ),
      )

      const error = yield* worktree
        .create({
          projectID: input.projectID,
          strategy: gitWorktree,
          from: input.sourceDirectory,
          directory: parent,
          name: "worktree",
        })
        .pipe(Effect.flip)

      expect(error).toBeInstanceOf(Worktree.DestinationExistsError)
      if (error instanceof Worktree.DestinationExistsError)
        expect(error.directory).toBe(abs(path.join(parent, "worktree-10")))
    }),
  )

  it.live("does not publish an event when refresh finds no directory changes", () =>
    Effect.gen(function* () {
      const input = yield* setup()
      const worktree = yield* Worktree.Service
      const bus = yield* Bus.Service
      const event = yield* bus.subscribe(Worktree.Event.Updated).pipe(
        Stream.take(1),
        Stream.runCollect,
        Effect.forkScoped,
        Effect.flatMap((fiber) =>
          Effect.gen(function* () {
            yield* Effect.yieldNow
            yield* worktree.refresh({ projectID: input.projectID })
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
      const worktree = yield* Worktree.Service
      const bus = yield* Bus.Service
      const target = abs(`${input.root.path}-worktree-external`)
      yield* Effect.addFinalizer(() =>
        Effect.promise(() => fs.rm(target, { recursive: true, force: true })).pipe(Effect.ignore),
      )
      yield* Effect.promise(() => $`git worktree add --detach ${target} HEAD`.cwd(input.root.path).quiet())
      yield* input.db
        .insert(WorktreeTable)
        .values({ project_id: input.projectID, directory: target })
        .run()
        .pipe(Effect.orDie)
      const fiber = yield* bus
        .subscribe(Worktree.Event.Updated)
        .pipe(Stream.take(1), Stream.runCollect, Effect.forkScoped)
      yield* Effect.yieldNow

      const discovered = abs(yield* Effect.promise(() => fs.realpath(target)))
      expect(yield* worktree.refresh({ projectID: input.projectID })).toEqual({ updated: [discovered], removed: [] })

      expect(yield* stored(input.projectID)).toEqual(
        [
          { directory: input.sourceDirectory, strategy: null },
          { directory: discovered, strategy: "git" },
        ].toSorted((a, b) => a.directory.localeCompare(b.directory)),
      )
      expect(Array.from(yield* Fiber.join(fiber))[0]?.data).toEqual({ projectID: input.projectID })

      yield* Effect.promise(() => $`git worktree remove --force ${target}`.cwd(input.root.path).quiet())
      expect(yield* worktree.refresh({ projectID: input.projectID })).toEqual({ updated: [], removed: [discovered] })
      expect(yield* stored(input.projectID)).toEqual([{ directory: input.sourceDirectory, strategy: null }])
    }),
  )

  it.live(
    "refresh ignores stale git worktree registrations",
    () =>
      Effect.gen(function* () {
        const input = yield* setup()
        const worktree = yield* Worktree.Service
        const stale = abs(`${input.root.path}-worktree-stale`)
        const target = abs(`${input.root.path}-worktree-after-stale`)
        yield* Effect.addFinalizer(() =>
          Effect.promise(() => fs.rm(target, { recursive: true, force: true })).pipe(Effect.ignore),
        )
        yield* Effect.promise(() => $`git worktree add --detach ${stale} HEAD`.cwd(input.root.path).quiet())
        yield* Effect.promise(() => fs.rm(stale, { recursive: true, force: true }))
        yield* Effect.promise(() => $`git worktree add --detach ${target} HEAD`.cwd(input.root.path).quiet())

        yield* worktree.refresh({ projectID: input.projectID })

        const discovered = abs(yield* Effect.promise(() => fs.realpath(target)))
        expect(yield* stored(input.projectID)).toEqual(
          [
            { directory: input.sourceDirectory, strategy: null },
            { directory: discovered, strategy: "git" },
          ].toSorted((a, b) => a.directory.localeCompare(b.directory)),
        )
      }),
    15_000,
  )

  it.live("refresh ignores existing directories that are no longer git checkouts", () =>
    Effect.gen(function* () {
      const input = yield* setup()
      yield* Effect.promise(() => fs.rm(path.join(input.sourceDirectory, ".git"), { recursive: true }))
      const worktree = yield* Worktree.Service

      yield* worktree.refresh({ projectID: input.projectID })

      expect(yield* stored(input.projectID)).toEqual([{ directory: input.sourceDirectory, strategy: null }])
    }),
  )

  it.live("refresh with no roots is a no-op", () =>
    Effect.gen(function* () {
      const worktree = yield* Worktree.Service

      expect(yield* worktree.refresh({ projectID: Project.ID.make("missing-project") })).toEqual({
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
        .insert(WorktreeTable)
        .values({ project_id: input.projectID, directory: missing })
        .run()
        .pipe(Effect.orDie)
      const worktree = yield* Worktree.Service

      expect(yield* worktree.refresh({ projectID: input.projectID })).toEqual({ updated: [], removed: [missing] })

      expect(yield* stored(input.projectID)).not.toContainEqual({ directory: missing, strategy: null })
    }),
  )
})
