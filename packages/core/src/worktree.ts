export * as Worktree from "./worktree.js"

import { Context, Effect, Layer, Schema } from "effect"
import { and, asc, desc, eq, isNotNull, isNull, ne, or } from "drizzle-orm"
import path from "path"
import { AbsolutePath } from "./schema.js"
import { FSUtil } from "@opencode-ai/util/fs-util"
import { Git } from "./git.js"
import { makeGlobalNode, makeLocationNode } from "@opencode-ai/util/effect/app-node"
import { ProjectSchema } from "./project/schema.js"
import { Slug } from "./util/slug.js"
import { Bus } from "./bus.js"
import { Database } from "./database/database.js"
import { Location } from "./location.js"
import { Worktree } from "@opencode-ai/schema/worktree"
import { WorktreeTable } from "./worktree/sql.js"
import { canonical, DirectoryUnavailableError } from "./worktree/directory.js"
import { WorktreeGit } from "./worktree/git.js"
import type { EffectDrizzleSqlite } from "./database/drizzle.js"
import { ProjectTable } from "./project/sql.js"

export { DirectoryUnavailableError } from "./worktree/directory.js"

export const StrategyID = Worktree.StrategyID
export type StrategyID = typeof StrategyID.Type

export const CreateInput = Worktree.CreateInput
export type CreateInput = typeof CreateInput.Type

export const RemoveInput = Worktree.RemoveInput
export type RemoveInput = typeof RemoveInput.Type

export const RefreshInput = Schema.Struct({
  projectID: ProjectSchema.ID,
}).annotate({ identifier: "Worktree.RefreshInput" })
export type RefreshInput = typeof RefreshInput.Type

export const RefreshResult = Schema.Struct({
  updated: Schema.Array(AbsolutePath),
  removed: Schema.Array(AbsolutePath),
}).annotate({ identifier: "Worktree.RefreshResult" })
export type RefreshResult = typeof RefreshResult.Type

export const Info = Worktree.Info
export type Info = typeof Info.Type

export const ListInput = Worktree.ListInput
export type ListInput = typeof ListInput.Type

export const List = Worktree.List
export type List = typeof List.Type

export const ListEntry = Schema.Struct({
  directory: AbsolutePath,
  type: Schema.Literals(["root", "worktree"]),
}).annotate({ identifier: "Worktree.ListEntry" })
export type ListEntry = typeof ListEntry.Type

export class SourceDirectoryNotFoundError extends Schema.TaggedError<SourceDirectoryNotFoundError>()(
  "Worktree.SourceDirectoryNotFoundError",
  { projectID: ProjectSchema.ID, directory: Schema.optional(AbsolutePath) },
) {}

export class DestinationExistsError extends Schema.TaggedError<DestinationExistsError>()(
  "Worktree.DestinationExistsError",
  { directory: AbsolutePath },
) {}

export class InvalidDirectoryError extends Schema.TaggedError<InvalidDirectoryError>()(
  "Worktree.InvalidDirectoryError",
  { directory: AbsolutePath },
) {}

export class StrategyUnavailableError extends Schema.TaggedError<StrategyUnavailableError>()(
  "Worktree.StrategyUnavailableError",
  { strategy: StrategyID },
) {}

export class DuplicateStrategyError extends Schema.TaggedError<DuplicateStrategyError>()(
  "Worktree.DuplicateStrategyError",
  { strategy: StrategyID },
) {}

export type Error =
  | SourceDirectoryNotFoundError
  | DestinationExistsError
  | DirectoryUnavailableError
  | InvalidDirectoryError
  | StrategyUnavailableError
  | Git.WorktreeError

export interface Strategy {
  readonly id: StrategyID
  readonly create: (input: {
    sourceDirectory: AbsolutePath
    directory: AbsolutePath
  }) => Effect.Effect<Info, Git.WorktreeError | DirectoryUnavailableError>
  readonly remove: (input: {
    directory: AbsolutePath
    force: boolean
  }) => Effect.Effect<void, Git.WorktreeError | DirectoryUnavailableError>
  readonly list: (directory: AbsolutePath) => Effect.Effect<ListEntry[], Git.WorktreeError | DirectoryUnavailableError>
}

export const Event = Worktree.Event

interface StoredInput {
  readonly projectID: ProjectSchema.ID
  readonly directory: AbsolutePath
  readonly strategy?: string
}

type DatabaseClient = EffectDrizzleSqlite.EffectSQLiteDatabase
type Transaction = Parameters<Parameters<DatabaseClient["transaction"]>[0]>[0]

export interface Interface {
  readonly register: (strategy: Strategy) => Effect.Effect<void, DuplicateStrategyError>
  readonly list: (projectID: ProjectSchema.ID) => Effect.Effect<List>
  readonly create: (input: CreateInput) => Effect.Effect<Info, Error>
  readonly remove: (input: RemoveInput) => Effect.Effect<void, Error>
  readonly refresh: (input: RefreshInput) => Effect.Effect<RefreshResult, Error>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/v2/Worktree") {}

export const refreshAfterBoot = Effect.gen(function* () {
  const location = yield* Location.Service
  const worktrees = yield* Service
  yield* Effect.gen(function* () {
    yield* Effect.logInfo("worktree refresh started", { projectID: location.project.id })
    const result = yield* worktrees.refresh({ projectID: location.project.id })
    yield* Effect.logInfo("worktree refresh done", {
      projectID: location.project.id,
      updated: result.updated,
      removed: result.removed,
    })
  }).pipe(
    Effect.catchCause((cause) => Effect.logWarning("worktree refresh failed", { cause })),
    Effect.forkScoped,
    Effect.asVoid,
  )
})

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const fs = yield* FSUtil.Service
    const db = (yield* Database.Service).db
    const bus = yield* Bus.Service

    const changed = Effect.fnUntraced(function* (projectID: ProjectSchema.ID, update: boolean) {
      if (update) yield* bus.publish(Event.Updated, { projectID })
    })

    const ops = {
      list: Effect.fn("Worktree.list")(function* (projectID: ProjectSchema.ID) {
        const rows = yield* db
          .select({ directory: WorktreeTable.directory, strategy: WorktreeTable.strategy })
          .from(WorktreeTable)
          .where(eq(WorktreeTable.project_id, projectID))
          .orderBy(desc(WorktreeTable.time_created), asc(WorktreeTable.directory))
          .all()
          .pipe(Effect.orDie)
        return rows.map((row) => ({ directory: row.directory, strategy: row.strategy ?? undefined }))
      }),
      find: Effect.fnUntraced(function* (projectID: ProjectSchema.ID, directory: AbsolutePath) {
        const row = yield* db
          .select({ directory: WorktreeTable.directory, strategy: WorktreeTable.strategy })
          .from(WorktreeTable)
          .where(and(eq(WorktreeTable.project_id, projectID), eq(WorktreeTable.directory, directory)))
          .get()
          .pipe(Effect.orDie)
        return row ? { directory: row.directory, strategy: row.strategy ?? undefined } : undefined
      }),
      primary: Effect.fnUntraced(function* (projectID: ProjectSchema.ID) {
        return yield* db
          .select({ directory: ProjectTable.worktree })
          .from(ProjectTable)
          .where(eq(ProjectTable.id, projectID))
          .get()
          .pipe(Effect.orDie)
      }),
      create: (input: StoredInput, tx?: Transaction) =>
        (tx ?? db)
          .insert(WorktreeTable)
          .values({ project_id: input.projectID, directory: input.directory, strategy: input.strategy })
          .onConflictDoUpdate({
            target: [WorktreeTable.project_id, WorktreeTable.directory],
            set: { strategy: input.strategy ?? null },
            setWhere: input.strategy
              ? or(isNull(WorktreeTable.strategy), ne(WorktreeTable.strategy, input.strategy))
              : isNotNull(WorktreeTable.strategy),
          })
          .returning({ directory: WorktreeTable.directory })
          .get()
          .pipe(
            Effect.orDie,
            Effect.map((row) => row !== undefined),
          ),
      remove: (projectID: ProjectSchema.ID, directory: AbsolutePath, tx?: Transaction) =>
        (tx ?? db)
          .delete(WorktreeTable)
          .where(and(eq(WorktreeTable.project_id, projectID), eq(WorktreeTable.directory, directory)))
          .returning({ directory: WorktreeTable.directory })
          .get()
          .pipe(
            Effect.orDie,
            Effect.map((row) => row !== undefined),
          ),
    }

    const registry = new Map<StrategyID, Strategy>()

    const register = Effect.fn("Worktree.register")(function* (strategy: Strategy) {
      if (registry.has(strategy.id)) return yield* new DuplicateStrategyError({ strategy: strategy.id })
      registry.set(strategy.id, strategy)
    })

    // Register default strategies
    const gitStrategy = yield* WorktreeGit.make
    yield* register(gitStrategy).pipe(Effect.orDie)

    const strategies = () => Array.from(registry.values())

    const source = Effect.fnUntraced(function* (input: AbsolutePath | undefined, projectID: ProjectSchema.ID) {
      const sourceDirectory = input ?? (yield* ops.primary(projectID))?.directory
      if (!sourceDirectory) return yield* new SourceDirectoryNotFoundError({ projectID })
      const resolved = yield* canonical(fs, sourceDirectory)
      if ((yield* ops.find(projectID, resolved)) === undefined)
        return yield* new SourceDirectoryNotFoundError({ projectID, directory: resolved })
      return resolved
    })

    const getStrategy = Effect.fnUntraced(function* (id: StrategyID) {
      const found = registry.get(id)
      if (!found) return yield* new StrategyUnavailableError({ strategy: id })
      return found
    })

    const create = Effect.fn("Worktree.create")(function* (input: CreateInput) {
      const selected = yield* getStrategy(input.strategy)
      const sourceDirectory = yield* source(input.from, input.projectID)
      yield* fs.makeDirectory(input.directory, { recursive: true }).pipe(Effect.orDie)
      const name = input.name ?? Slug.create()
      let suffix = 1
      let worktreeDirectory = AbsolutePath.make(path.join(input.directory, name))
      while (yield* fs.existsSafe(worktreeDirectory)) {
        suffix++
        if (suffix > 10) return yield* new DestinationExistsError({ directory: worktreeDirectory })
        worktreeDirectory = AbsolutePath.make(path.join(input.directory, `${name}-${suffix}`))
      }

      const result = yield* selected.create({
        directory: worktreeDirectory,
        sourceDirectory,
      })
      yield* changed(
        input.projectID,
        yield* ops.create({
          projectID: input.projectID,
          directory: result.directory,
          strategy: input.strategy,
        }),
      )
      return result
    })

    const remove = Effect.fn("Worktree.remove")(function* (input: RemoveInput) {
      const worktreeDirectory = yield* canonical(fs, input.directory)
      const stored = yield* ops.find(input.projectID, worktreeDirectory)
      if (!stored?.strategy) return yield* new InvalidDirectoryError({ directory: worktreeDirectory })
      yield* (yield* getStrategy(StrategyID.make(stored.strategy))).remove({
        directory: worktreeDirectory,
        force: input.force,
      })
      yield* changed(input.projectID, yield* ops.remove(input.projectID, worktreeDirectory))
    })

    const refresh = Effect.fn("Worktree.refresh")(function* (input: RefreshInput) {
      const stored = yield* ops.list(input.projectID)
      const checked = yield* Effect.forEach(
        stored,
        (item) => fs.isDir(item.directory).pipe(Effect.map((exists) => ({ ...item, exists }))),
        { concurrency: "unbounded" },
      )
      const sourceDirectories = checked
        .filter((item) => item.strategy === undefined && item.exists)
        .map((item) => item.directory)
      const discovered = yield* Effect.forEach(
        sourceDirectories,
        (sourceDirectory) =>
          Effect.forEach(strategies(), (strategy) =>
            strategy.list(sourceDirectory).pipe(
              Effect.catchTag("Worktree.DirectoryUnavailableError", () => Effect.succeed([])),
              Effect.map((items) =>
                items.map((item) => ({
                  directory: item.directory,
                  strategy: item.type === "worktree" ? strategy.id : undefined,
                })),
              ),
            ),
          ),
        { concurrency: "unbounded" },
      ).pipe(
        Effect.map((sets) => new Map(sets.flat(2).map((item) => [item.directory, item] as const)).values().toArray()),
      )
      const removed = checked.filter((item) => !item.exists).map((item) => item.directory)
      const result = yield* db
        .transaction((tx) =>
          Effect.all({
            updated: Effect.forEach(discovered, (item) =>
              ops.create(
                {
                  projectID: input.projectID,
                  directory: item.directory,
                  strategy: item.strategy,
                },
                tx,
              ),
            ),
            removed: Effect.forEach(removed, (directory) => ops.remove(input.projectID, directory, tx)),
          }),
        )
        .pipe(Effect.orDie)
      const changes = {
        updated: discovered.filter((_, index) => result.updated[index]).map((item) => item.directory),
        removed: removed.filter((_, index) => result.removed[index]),
      }
      yield* changed(input.projectID, changes.updated.length > 0 || changes.removed.length > 0)
      return changes
    })

    return Service.of({
      register,
      list: ops.list,
      create,
      remove,
      refresh,
    })
  }),
)

export const node = makeGlobalNode({
  service: Service,
  layer: layer,
  deps: [FSUtil.node, Git.node, Bus.node, Database.node],
})

export const refreshNode = makeLocationNode({
  name: "worktree-refresh",
  layer: Layer.effectDiscard(refreshAfterBoot),
  deps: [node, Location.node],
})
