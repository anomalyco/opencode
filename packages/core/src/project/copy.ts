export * as ProjectCopy from "./copy"

import { Context, Effect, Layer, Schema } from "effect"
import path from "path"
import { AbsolutePath } from "../schema"
import { FSUtil } from "../fs-util"
import { Git } from "../git"
import { LayerNode } from "../effect/layer-node"
import { Project } from "../project"
import { ProjectDirectories } from "./directories"
import { makeGitWorktreeStrategy } from "./copy-strategies"
import { Slug } from "../util/slug"
import { EventV2 } from "../event"
import { Database } from "../database/database"
import { Location } from "../location"
import { PluginBoot } from "../plugin/boot"

export const StrategyID = Schema.Trim.pipe(Schema.check(Schema.isNonEmpty()), Schema.brand("ProjectCopy.StrategyID"))
export type StrategyID = typeof StrategyID.Type

export const CreateInput = Schema.Struct({
  projectID: Project.ID,
  strategy: StrategyID,
  sourceDirectory: AbsolutePath,
  directory: AbsolutePath,
  name: Schema.optional(Schema.String),
}).annotate({ identifier: "ProjectCopy.CreateInput" })
export type CreateInput = typeof CreateInput.Type

export const RemoveInput = Schema.Struct({
  projectID: Project.ID,
  directory: AbsolutePath,
  force: Schema.Boolean,
}).annotate({ identifier: "ProjectCopy.RemoveInput" })
export type RemoveInput = typeof RemoveInput.Type

export const RefreshInput = Schema.Struct({
  projectID: Project.ID,
}).annotate({ identifier: "ProjectCopy.RefreshInput" })
export type RefreshInput = typeof RefreshInput.Type

export const RefreshResult = Schema.Struct({
  updated: Schema.Array(AbsolutePath),
  removed: Schema.Array(AbsolutePath),
}).annotate({ identifier: "ProjectCopy.RefreshResult" })
export type RefreshResult = typeof RefreshResult.Type

export const Copy = Schema.Struct({
  directory: AbsolutePath,
}).annotate({ identifier: "ProjectCopy.Copy" })
export type Copy = typeof Copy.Type

export const ListEntry = Schema.Struct({
  directory: AbsolutePath,
  type: Schema.Literals(["root", "copy"]),
}).annotate({ identifier: "ProjectCopy.ListEntry" })
export type ListEntry = typeof ListEntry.Type

export class SourceDirectoryNotFoundError extends Schema.TaggedErrorClass<SourceDirectoryNotFoundError>()(
  "ProjectCopy.SourceDirectoryNotFoundError",
  { directory: AbsolutePath },
) {}

export class DestinationExistsError extends Schema.TaggedErrorClass<DestinationExistsError>()(
  "ProjectCopy.DestinationExistsError",
  { directory: AbsolutePath },
) {}

export class DirectoryUnavailableError extends Schema.TaggedErrorClass<DirectoryUnavailableError>()(
  "ProjectCopy.DirectoryUnavailableError",
  { directory: AbsolutePath },
) {}

export class InvalidDirectoryError extends Schema.TaggedErrorClass<InvalidDirectoryError>()(
  "ProjectCopy.InvalidDirectoryError",
  { directory: AbsolutePath },
) {}

export class StrategyUnavailableError extends Schema.TaggedErrorClass<StrategyUnavailableError>()(
  "ProjectCopy.StrategyUnavailableError",
  { strategy: StrategyID },
) {}

export class DuplicateStrategyError extends Schema.TaggedErrorClass<DuplicateStrategyError>()(
  "ProjectCopy.DuplicateStrategyError",
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
  }) => Effect.Effect<Copy, Git.WorktreeError | DirectoryUnavailableError>
  readonly remove: (input: {
    directory: AbsolutePath
    force: boolean
  }) => Effect.Effect<void, Git.WorktreeError | DirectoryUnavailableError>
  readonly list: (directory: AbsolutePath) => Effect.Effect<ListEntry[], Git.WorktreeError | DirectoryUnavailableError>
}

export const Event = {
  Updated: EventV2.define({
    type: "project.directories.updated",
    schema: { projectID: Project.ID },
  }),
}

export interface Interface {
  readonly register: (strategy: Strategy) => Effect.Effect<void, DuplicateStrategyError>
  readonly create: (input: CreateInput) => Effect.Effect<Copy, Error>
  readonly remove: (input: RemoveInput) => Effect.Effect<void, Error>
  readonly refresh: (input: RefreshInput) => Effect.Effect<RefreshResult, Error>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/ProjectCopy") {}

export const refreshAfterBoot = Effect.gen(function* () {
  const location = yield* Location.Service
  const boot = yield* PluginBoot.Service
  const copies = yield* Service
  yield* Effect.gen(function* () {
    yield* boot.wait()
    yield* Effect.logInfo("project copy refresh started", { projectID: location.project.id })
    const result = yield* copies.refresh({ projectID: location.project.id })
    yield* Effect.logInfo("project copy refresh done", {
      projectID: location.project.id,
      updated: result.updated,
      removed: result.removed,
    })
  }).pipe(
    Effect.catchCause((cause) => Effect.logWarning("project copy refresh failed", { cause })),
    Effect.forkScoped,
    Effect.asVoid,
  )
})

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const fs = yield* FSUtil.Service
    const git = yield* Git.Service
    const directories = yield* ProjectDirectories.Service
    const db = (yield* Database.Service).db
    const events = yield* EventV2.Service

    const changed = Effect.fnUntraced(function* (projectID: Project.ID, update: boolean) {
      if (update) yield* events.publish(Event.Updated, { projectID })
    })

    const canonical = Effect.fnUntraced(function* (input: AbsolutePath) {
      const resolved = AbsolutePath.make(FSUtil.resolve(input))
      if (!(yield* fs.isDir(resolved))) return yield* new DirectoryUnavailableError({ directory: input })
      return resolved
    })

    const registry = new Map<StrategyID, Strategy>()

    const register = Effect.fn("ProjectCopy.register")(function* (strategy: Strategy) {
      if (registry.has(strategy.id)) return yield* new DuplicateStrategyError({ strategy: strategy.id })
      registry.set(strategy.id, strategy)
    })

    // Register default strategies
    yield* register(makeGitWorktreeStrategy({ git, canonical })).pipe(Effect.orDie)

    const strategies = () => Array.from(registry.values())

    const source = Effect.fnUntraced(function* (input: AbsolutePath, projectID: Project.ID) {
      const sourceDirectory = yield* canonical(input)
      if (!(yield* directories.contains({ projectID, directory: sourceDirectory })))
        return yield* new SourceDirectoryNotFoundError({ directory: sourceDirectory })
      return sourceDirectory
    })

    const getStrategy = Effect.fnUntraced(function* (id: StrategyID) {
      const found = registry.get(id)
      if (!found) return yield* new StrategyUnavailableError({ strategy: id })
      return found
    })

    const create = Effect.fn("ProjectCopy.create")(function* (input: CreateInput) {
      const selected = yield* getStrategy(input.strategy)
      const sourceDirectory = yield* source(input.sourceDirectory, input.projectID)
      yield* fs.makeDirectory(input.directory, { recursive: true }).pipe(Effect.orDie)
      const name = input.name ?? Slug.create()
      let suffix = 1
      let copyDirectory = AbsolutePath.make(path.join(input.directory, name))
      while (yield* fs.existsSafe(copyDirectory)) {
        suffix++
        if (suffix > 10) return yield* new DestinationExistsError({ directory: copyDirectory })
        copyDirectory = AbsolutePath.make(path.join(input.directory, `${name}-${suffix}`))
      }

      const result = yield* selected.create({
        directory: copyDirectory,
        sourceDirectory,
      })
      yield* changed(
        input.projectID,
        yield* directories.create({
          projectID: input.projectID,
          directory: result.directory,
          strategy: input.strategy,
          behavior: "replace",
        }),
      )
      return result
    })

    const remove = Effect.fn("ProjectCopy.remove")(function* (input: RemoveInput) {
      const copyDirectory = yield* canonical(input.directory)
      const stored = yield* directories.get({ projectID: input.projectID, directory: copyDirectory })
      if (!stored?.strategy) return yield* new InvalidDirectoryError({ directory: copyDirectory })
      yield* (yield* getStrategy(StrategyID.make(stored.strategy))).remove({
        directory: copyDirectory,
        force: input.force,
      })
      yield* changed(
        input.projectID,
        yield* directories.remove({ projectID: input.projectID, directory: copyDirectory }),
      )
    })

    const refresh = Effect.fn("ProjectCopy.refresh")(function* (input: RefreshInput) {
      const stored = yield* directories.list(input.projectID)
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
              Effect.catchTag("ProjectCopy.DirectoryUnavailableError", () => Effect.succeed([])),
              Effect.map((items) =>
                items.map((item) => ({
                  directory: item.directory,
                  strategy: item.type === "copy" ? strategy.id : undefined,
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
              directories.create(
                {
                  projectID: input.projectID,
                  directory: item.directory,
                  strategy: item.strategy,
                  behavior: "replace",
                },
                tx,
              ),
            ),
            removed: Effect.forEach(removed, (directory) =>
              directories.remove({ projectID: input.projectID, directory }, tx),
            ),
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
      create,
      remove,
      refresh,
    })
  }),
)

export const locationLayer = layer
export const node = LayerNode.make(layer, [FSUtil.node, Git.node, ProjectDirectories.node, EventV2.node, Database.node])
