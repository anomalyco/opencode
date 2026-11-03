export * as Worktree from "./worktree.js"

import { Context, Effect, Layer, Schema } from "effect"
import { and, asc, desc, eq, isNotNull, isNull, ne, sql } from "drizzle-orm"
import path from "path"
import { AbsolutePath } from "./schema.js"
import { FSUtil } from "@opencode/util/fs-util"
import { Git } from "./git.js"
import { Node } from "@opencode/util/effect/app-node"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { Slug } from "./util/slug.js"
import { Bus } from "./bus.js"
import { Database } from "./database/database.js"
import { Location } from "./location.js"
import type { FileSystem } from "./filesystem.js"
import { LocationServiceMap } from "./location-service-map.js"
import { Project } from "./project.js"
import { ProjectSchema } from "./project/schema.js"
import { Worktree } from "@opencode/schema/worktree"
import { WorktreeTable } from "./worktree/sql.js"
import { canonical, DirectoryUnavailableError } from "./worktree/directory.js"
import type { EffectDrizzleSqlite } from "./database/drizzle.js"
import { ProjectTable } from "./project/sql.js"
import { AppProcess } from "@opencode/util/process"
import { ChildProcess } from "effect/process"
import { WorktreeStrategies } from "./worktree/strategies.js"

export type { Strategy, Editor } from "./worktree/strategies.js"

export { DirectoryUnavailableError } from "./worktree/directory.js"
export { OperationError } from "@opencode/schema/worktree"

export const StrategyID = Worktree.StrategyID
export type StrategyID = typeof StrategyID.Type

export const CreateInput = Worktree.CreateInput
export type CreateInput = typeof CreateInput.Type

export const RemoveInput = Worktree.RemoveInput
export type RemoveInput = typeof RemoveInput.Type

export const Info = Worktree.Info
export type Info = typeof Info.Type

export const List = Worktree.List
export type List = typeof List.Type

export const ListEntry = Worktree.ListEntry
export type ListEntry = typeof ListEntry.Type

export class SourceDirectoryNotFoundError extends Schema.TaggedError<SourceDirectoryNotFoundError>()(
  "Worktree.SourceDirectoryNotFoundError",
  { projectID: Project.ID, directory: Schema.optional(AbsolutePath) },
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

export type Error =
  | FileSystem.DirectoryNotFoundError
  | Project.NotFoundError
  | SourceDirectoryNotFoundError
  | DestinationExistsError
  | DirectoryUnavailableError
  | InvalidDirectoryError
  | StrategyUnavailableError
  | Worktree.OperationError
  | AppProcess.AppProcessError
  | Git.WorktreeError

export const Event = Worktree.Event

interface StoredInput {
  readonly directory: AbsolutePath
  readonly strategy?: StrategyID
  readonly replace?: boolean
}

type DatabaseClient = EffectDrizzleSqlite.EffectSQLiteDatabase
type Transaction = Parameters<Parameters<DatabaseClient["transaction"]>[0]>[0]

export interface Interface {
  readonly list: (input: { projectID: Project.ID }) => Effect.Effect<List, Project.NotFoundError>
  // The plugin bridge supplies its registry so canonical-project setup can use registrations made so far.
  readonly create: (input: CreateInput, current?: WorktreeStrategies.Interface) => Effect.Effect<Info, Error>
  readonly remove: (input: RemoveInput, current?: WorktreeStrategies.Interface) => Effect.Effect<void, Error>
  readonly refresh: (
    input: { projectID: Project.ID },
    current?: WorktreeStrategies.Interface,
  ) => Effect.Effect<void, Error>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/Worktree") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const fs = yield* FSUtil.Service
    const database = yield* Database.Service
    const db = database.db
    const bus = yield* Bus.Service
    const processService = yield* AppProcess.Service
    const locations = yield* LocationServiceMap.Service
    const project = Effect.fnUntraced(function* (projectID: Project.ID) {
      const row = yield* db.select().from(ProjectTable).where(eq(ProjectTable.id, projectID)).get().pipe(Effect.orDie)
      if (!row) return yield* new Project.NotFoundError({ projectID })
      return row
    })

    const load = Effect.fnUntraced(function* (directory: AbsolutePath, current?: WorktreeStrategies.Interface) {
      if (!(yield* fs.isDir(directory))) return yield* new DirectoryUnavailableError({ directory })
      if (current?.directory === directory) return current.get()
      const { Plugin } = yield* Effect.promise(() => import("./plugin.js"))
      const context = yield* locations.contextEffect(Location.Ref.make({ directory }))
      yield* Context.get(context, Plugin.Service).awaitActivation
      return Context.get(context, WorktreeStrategies.Service).get()
    })

    const changed = Effect.fnUntraced(function* (projectID: Project.ID, update: boolean) {
      if (update) yield* bus.publish(Event.Updated, { projectID })
    })

    const ops = {
      list: Effect.fnUntraced(function* (projectID: Project.ID) {
        const rows = yield* db
          .select({ directory: WorktreeTable.directory, strategy: WorktreeTable.strategy })
          .from(WorktreeTable)
          .where(eq(WorktreeTable.project_id, projectID))
          .orderBy(desc(WorktreeTable.time_created), asc(WorktreeTable.directory))
          .all()
          .pipe(Effect.orDie)
        return rows.map((row) => ({ directory: row.directory, strategy: row.strategy ?? undefined }))
      }),
      find: Effect.fnUntraced(function* (projectID: Project.ID, directory: AbsolutePath) {
        const row = yield* db
          .select({ directory: WorktreeTable.directory, strategy: WorktreeTable.strategy })
          .from(WorktreeTable)
          .where(and(eq(WorktreeTable.project_id, projectID), eq(WorktreeTable.directory, directory)))
          .get()
          .pipe(Effect.orDie)
        return row ? { directory: row.directory, strategy: row.strategy ?? undefined } : undefined
      }),
      create: (projectID: Project.ID, input: StoredInput, tx?: Transaction) =>
        (tx ?? db)
          .insert(WorktreeTable)
          .values({
            project_id: projectID,
            directory: input.directory,
            strategy: input.strategy,
          })
          .onConflictDoUpdate({
            target: [WorktreeTable.project_id, WorktreeTable.directory],
            set: {
              strategy: input.strategy ?? null,
            },
            // Discovery may claim an unowned row, but never replace another strategy's ownership.
            setWhere: input.replace
              ? input.strategy
                ? undefined
                : isNotNull(WorktreeTable.strategy)
              : input.strategy
                ? isNull(WorktreeTable.strategy)
                : sql`false`,
          })
          .returning({ directory: WorktreeTable.directory })
          .get()
          .pipe(
            Effect.orDie,
            Effect.map((row) => row !== undefined),
          ),
      remove: (projectID: Project.ID, directory: AbsolutePath, tx?: Transaction) =>
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

    const source = Effect.fnUntraced(function* (projectID: Project.ID, sourceDirectory: AbsolutePath) {
      const resolved = yield* canonical(fs, sourceDirectory)
      if ((yield* ops.find(projectID, resolved)) === undefined)
        return yield* new SourceDirectoryNotFoundError({ projectID, directory: resolved })
      return resolved
    })

    const getStrategy = Effect.fnUntraced(function* (
      id: StrategyID,
      strategies: ReadonlyMap<StrategyID, WorktreeStrategies.Strategy>,
    ) {
      const found = strategies.get(id)
      if (!found) return yield* new StrategyUnavailableError({ strategy: id })
      return found
    })

    const create = Effect.fn("Worktree.create")(function* (input: CreateInput, current?: WorktreeStrategies.Interface) {
      const row = yield* project(input.projectID)
      const settings = yield* load(row.worktree, current)
      const selected = yield* getStrategy(settings.selected, settings.strategies)
      const directory = input.directory ?? settings.directory
      const sourceDirectory = yield* source(input.projectID, input.from ?? row.worktree)
      yield* fs.makeDirectory(directory, { recursive: true }).pipe(Effect.orDie)
      const name = input.name ?? Slug.create()
      let suffix = 1
      let worktreeDirectory = AbsolutePath.make(path.join(directory, name))
      while (yield* fs.existsSafe(worktreeDirectory)) {
        suffix++
        if (suffix > 10) return yield* new DestinationExistsError({ directory: worktreeDirectory })
        worktreeDirectory = AbsolutePath.make(path.join(directory, `${name}-${suffix}`))
      }

      const created = yield* selected
        .create({
          directory: worktreeDirectory,
          sourceDirectory,
          branch: input.branch,
        })
        .pipe(Effect.mapError((error) => operationError(selected.id, "create", error)))
      const result = { directory: yield* canonical(fs, created.directory) }
      yield* changed(
        input.projectID,
        yield* ops.create(input.projectID, {
          directory: result.directory,
          strategy: selected.id,
          replace: true,
        }),
      )
      const command = row.commands?.start?.trim()
      if (command) {
        const windows = process.platform === "win32"
        yield* processService
          .run(
            ChildProcess.make(windows ? command : "bash", windows ? [] : ["-lc", command], {
              cwd: result.directory,
              env: {
                OPENCODE_WORKTREE_BASE: sourceDirectory,
                OPENCODE_WORKTREE_PATH: result.directory,
              },
              extendEnv: true,
              stdin: "ignore",
              shell: windows,
            }),
          )
          .pipe(Effect.flatMap(AppProcess.requireSuccess))
      }
      return result
    }, Effect.scoped)

    const remove = Effect.fn("Worktree.remove")(function* (input: RemoveInput, current?: WorktreeStrategies.Interface) {
      const row = yield* project(input.projectID)
      const worktreeDirectory = yield* canonical(fs, input.directory)
      const stored = yield* ops.find(input.projectID, worktreeDirectory)
      if (!stored?.strategy) return yield* new InvalidDirectoryError({ directory: worktreeDirectory })
      const settings = yield* load(row.worktree, current)
      const strategy = yield* getStrategy(stored.strategy, settings.strategies)
      yield* strategy
        .remove({
          directory: worktreeDirectory,
          force: input.force,
        })
        .pipe(Effect.mapError((error) => operationError(strategy.id, "remove", error)))
      yield* changed(input.projectID, yield* ops.remove(input.projectID, worktreeDirectory))
    }, Effect.scoped)

    const refresh = Effect.fn("Worktree.refresh")(function* (
      input: { projectID: Project.ID },
      current?: WorktreeStrategies.Interface,
    ) {
      const row = yield* project(input.projectID)
      const settings = yield* load(row.worktree, current)
      const stored = yield* ops.list(input.projectID)
      const checked = yield* Effect.forEach(
        stored,
        (item) => fs.isDir(item.directory).pipe(Effect.map((exists) => ({ ...item, exists }))),
        { concurrency: "unbounded" },
      )
      const otherProjects = yield* db
        .select({ worktree: ProjectTable.worktree })
        .from(ProjectTable)
        .where(and(ne(ProjectTable.id, input.projectID), isNull(ProjectTable.time_archived)))
        .all()
        .pipe(Effect.orDie)
      const foreign = new Set<AbsolutePath>()
      for (const item of otherProjects) {
        if (item.worktree !== row.worktree) {
          const resolved = yield* canonical(fs, item.worktree).pipe(
            Effect.catchTag("Worktree.DirectoryUnavailableError", () => Effect.succeed(item.worktree)),
          )
          foreign.add(resolved)
        }
      }
      const strategies = Array.from(settings.strategies.values()).toReversed()
      const discovered = new Map<AbsolutePath, StoredInput>()
      // Unowned rows are checkout/discovery roots. Managed children are enumerated by their backend.
      const roots = new Set([
        row.worktree,
        ...checked
          .filter((item) => item.exists && !item.strategy && !foreign.has(item.directory))
          .map((item) => item.directory),
      ])
      const failedRoots = new Set<AbsolutePath>()
      for (const directory of roots) {
        if (!(yield* fs.isDir(directory))) {
          failedRoots.add(directory)
          continue
        }
        for (const strategy of strategies) {
          let unavailable = false
          const entries = yield* strategy.list(directory).pipe(
            Effect.mapError((error) => operationError(strategy.id, "list", error)),
            Effect.catch((error) => {
              if (error instanceof DirectoryUnavailableError) {
                unavailable = true
                return Effect.succeed([] as Worktree.ListEntry[])
              }
              return Effect.logWarning("worktree discovery failed", { directory, strategy: strategy.id, error }).pipe(
                Effect.as([] as Worktree.ListEntry[]),
              )
            }),
          )
          if (unavailable) {
            failedRoots.add(directory)
            continue
          }
          for (const entry of entries) {
            const directory = yield* canonical(fs, entry.directory).pipe(
              Effect.catchTag("Worktree.DirectoryUnavailableError", () => Effect.undefined),
            )
            if (!directory || discovered.has(directory) || foreign.has(directory)) continue
            discovered.set(directory, {
              directory,
              strategy: directory === row.worktree ? undefined : entry.type === "worktree" ? strategy.id : undefined,
              replace: directory === row.worktree ? true : undefined,
            })
          }
        }
      }
      if (failedRoots.has(row.worktree)) {
        let nextRoot = Array.from(discovered.keys())[0]
        if (!nextRoot) {
          const candidate = checked.find(
            (item) => item.exists && !failedRoots.has(item.directory) && !foreign.has(item.directory),
          )?.directory
          if (candidate) {
            for (const strategy of strategies) {
              const entries = yield* strategy.list(candidate).pipe(
                Effect.mapError((error) => operationError(strategy.id, "list", error)),
                Effect.catch((error) => {
                  if (error instanceof DirectoryUnavailableError) {
                    return Effect.succeed([] as Worktree.ListEntry[])
                  }
                  return Effect.logWarning("worktree discovery failed", {
                    directory: candidate,
                    strategy: strategy.id,
                    error,
                  }).pipe(Effect.as([] as Worktree.ListEntry[]))
                }),
              )
              for (const entry of entries) {
                const directory = yield* canonical(fs, entry.directory).pipe(
                  Effect.catchTag("Worktree.DirectoryUnavailableError", () => Effect.undefined),
                )
                if (!directory || discovered.has(directory) || foreign.has(directory)) continue
                discovered.set(directory, {
                  directory,
                  strategy: directory === candidate ? undefined : entry.type === "worktree" ? strategy.id : undefined,
                  replace: directory === candidate ? true : undefined,
                })
              }
            }
            if (discovered.has(candidate)) {
              nextRoot = candidate
            } else {
              nextRoot = Array.from(discovered.keys())[0] ?? candidate
            }
          }
        }
        if (nextRoot) {
          yield* db
            .update(ProjectTable)
            .set({ worktree: nextRoot })
            .where(eq(ProjectTable.id, input.projectID))
            .run()
            .pipe(Effect.orDie)
          row.worktree = nextRoot
          yield* db
            .update(WorktreeTable)
            .set({ strategy: null })
            .where(and(eq(WorktreeTable.project_id, input.projectID), eq(WorktreeTable.directory, nextRoot)))
            .run()
            .pipe(Effect.orDie)
          discovered.set(nextRoot, { directory: nextRoot, strategy: undefined, replace: true })
          yield* bus.publish(ProjectSchema.Event.Updated, {
            id: row.id,
            canonical: nextRoot,
            sandboxes: row.sandboxes,
            time: {
              created: row.time_created,
              updated: row.time_updated,
              active: row.time_active,
              archived: row.time_archived ?? undefined,
            },
          })
        } else {
          failedRoots.delete(row.worktree)
        }
      }
      const removed = checked
        .filter(
          (item) =>
            !item.exists ||
            (failedRoots.has(item.directory) && item.directory !== row.worktree) ||
            (item.directory !== row.worktree && foreign.has(item.directory)),
        )
        .map((item) => item.directory)
      const changes = yield* db
        .transaction((tx) =>
          Effect.all({
            updated: Effect.filter(Array.from(discovered.values()), (item) =>
              ops.create(input.projectID, item, tx),
            ).pipe(Effect.map((items) => items.map((item) => item.directory))),
            removed: Effect.filter(removed, (directory) => ops.remove(input.projectID, directory, tx)),
          }),
        )
        .pipe(Effect.orDie)
      yield* changed(input.projectID, changes.updated.length > 0 || changes.removed.length > 0)
    }, Effect.scoped)

    return Service.of({
      list: Effect.fn("Worktree.list")(function* (input) {
        yield* project(input.projectID)
        return yield* ops.list(input.projectID)
      }),
      create,
      remove,
      refresh,
    })
  }),
)

export const node: LayerNode.Provider<Service, never, typeof Node.tags.values.global> = Node.makeGlobalNode({
  service: Service,
  layer,
  deps: [FSUtil.node, Bus.node, Database.node, AppProcess.node, LocationServiceMap.node],
})

function operationError(strategy: StrategyID, operation: string, error: unknown) {
  if (
    error instanceof Git.WorktreeError ||
    error instanceof DirectoryUnavailableError ||
    error instanceof Worktree.OperationError
  )
    return error
  return new Worktree.OperationError({
    message: `Worktree strategy ${strategy} failed to ${operation}: ${error instanceof globalThis.Error ? error.message : String(error)}`,
  })
}
