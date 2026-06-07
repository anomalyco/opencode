export * as ProjectCopy from "./copy"

import { and, eq, inArray } from "drizzle-orm"
import { Context, Effect, Layer, Schema } from "effect"
import path from "path"
import { AbsolutePath } from "../schema"
import { FSUtil } from "../fs-util"
import { Git } from "../git"
import { Database } from "../database/database"
import { EventV2 } from "../event"
import { Project } from "../project"
import { ProjectDirectoryTable } from "./sql"
import { makeStrategies } from "./copy-strategies"
import { Slug } from "../util/slug"

export const StrategyID = Schema.Literal("git_worktree")
export type StrategyID = typeof StrategyID.Type

export const DetectInput = Schema.Struct({
  directory: AbsolutePath,
}).annotate({ identifier: "ProjectCopy.DetectInput" })
export type DetectInput = typeof DetectInput.Type

export const CreateInput = Schema.Struct({
  projectID: Project.ID,
  strategy: StrategyID,
  sourceDirectory: AbsolutePath,
  directory: AbsolutePath,
  name: Schema.optional(Schema.String),
  context: Schema.optional(Schema.String),
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

export const Copy = Schema.Struct({
  directory: AbsolutePath,
}).annotate({ identifier: "ProjectCopy.Copy" })
export type Copy = typeof Copy.Type

export type DirectoryType = "main" | "root" | StrategyID

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

export class StrategyNotFoundError extends Schema.TaggedErrorClass<StrategyNotFoundError>()(
  "ProjectCopy.StrategyNotFoundError",
  { directory: AbsolutePath },
) {}

export type Error =
  | SourceDirectoryNotFoundError
  | DestinationExistsError
  | DirectoryUnavailableError
  | StrategyNotFoundError
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
  readonly list: (directory: AbsolutePath) => Effect.Effect<Copy[], Git.WorktreeError | DirectoryUnavailableError>
  readonly detect: (directory: AbsolutePath) => Effect.Effect<boolean>
}

export const Event = {
  Updated: EventV2.define({
    type: "project.directories.updated",
    schema: { projectID: Project.ID },
  }),
}

export interface Interface {
  readonly detect: (input: DetectInput) => Effect.Effect<StrategyID | undefined>
  readonly create: (input: CreateInput) => Effect.Effect<Copy, Error>
  readonly remove: (input: RemoveInput) => Effect.Effect<void, Error>
  readonly refresh: (input: RefreshInput) => Effect.Effect<void, Error>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/ProjectCopy") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const fs = yield* FSUtil.Service
    const git = yield* Git.Service
    const events = yield* EventV2.Service
    const db = (yield* Database.Service).db

    const canonical = Effect.fnUntraced(function* (input: AbsolutePath) {
      const resolved = AbsolutePath.make(FSUtil.resolve(input))
      if (!(yield* fs.isDir(resolved))) return yield* new DirectoryUnavailableError({ directory: input })
      return resolved
    })

    const registry = makeStrategies({ git, fs, canonical })

    const source = Effect.fnUntraced(function* (input: AbsolutePath, projectID: Project.ID) {
      const sourceDirectory = yield* canonical(input)
      const row = yield* db
        .select({ directory: ProjectDirectoryTable.directory })
        .from(ProjectDirectoryTable)
        .where(
          and(eq(ProjectDirectoryTable.project_id, projectID), eq(ProjectDirectoryTable.directory, sourceDirectory)),
        )
        .get()
        .pipe(Effect.orDie)
      if (!row) return yield* new SourceDirectoryNotFoundError({ directory: sourceDirectory })
      return sourceDirectory
    })

    const insert = Effect.fnUntraced(function* (projectID: Project.ID, copyDirectory: AbsolutePath, type: StrategyID) {
      return yield* db
        .transaction(
          (tx) =>
            Effect.gen(function* () {
              const row = yield* tx
                .select({ directory: ProjectDirectoryTable.directory })
                .from(ProjectDirectoryTable)
                .where(
                  and(
                    eq(ProjectDirectoryTable.project_id, projectID),
                    eq(ProjectDirectoryTable.directory, copyDirectory),
                  ),
                )
                .get()
              if (row) return false
              yield* tx
                .insert(ProjectDirectoryTable)
                .values({ project_id: projectID, directory: copyDirectory, type })
                .run()
              return true
            }),
          { behavior: "immediate" },
        )
        .pipe(Effect.orDie)
    })

    const removeStored = Effect.fnUntraced(function* (projectID: Project.ID, copyDirectory: AbsolutePath) {
      return (
        (yield* db
          .delete(ProjectDirectoryTable)
          .where(
            and(eq(ProjectDirectoryTable.project_id, projectID), eq(ProjectDirectoryTable.directory, copyDirectory)),
          )
          .returning({ directory: ProjectDirectoryTable.directory })
          .get()
          .pipe(Effect.orDie)) !== undefined
      )
    })

    const changed = Effect.fnUntraced(function* (projectID: Project.ID, update: boolean) {
      if (update) yield* events.publish(Event.Updated, { projectID })
    })

    const strategy = (id: StrategyID) => registry.get(id) as Strategy

    const detect = Effect.fn("ProjectCopy.detect")(function* (input: DetectInput) {
      for (const strategy of registry.values()) {
        if (yield* strategy.detect(input.directory)) return strategy.id
      }
      return undefined
    })

    const create = Effect.fn("ProjectCopy.create")(function* (input: CreateInput) {
      yield* fs.makeDirectory(input.directory, { recursive: true }).pipe(Effect.orDie)
      const name = input.name ?? Slug.create()
      let suffix = 1
      let copyDirectory = AbsolutePath.make(path.join(input.directory, name))
      while (yield* fs.existsSafe(copyDirectory)) {
        suffix++
        if (suffix > 10) return yield* new DestinationExistsError({ directory: copyDirectory })
        copyDirectory = AbsolutePath.make(path.join(input.directory, `${name}-${suffix}`))
      }

      const result = yield* strategy(input.strategy).create({
        directory: copyDirectory,
        sourceDirectory: yield* source(input.sourceDirectory, input.projectID),
      })
      yield* changed(input.projectID, yield* insert(input.projectID, result.directory, input.strategy))
      return result
    })

    const remove = Effect.fn("ProjectCopy.remove")(function* (input: RemoveInput) {
      const copyDirectory = yield* canonical(input.directory)
      const id = yield* detect({ directory: copyDirectory })
      if (!id) return yield* new StrategyNotFoundError({ directory: copyDirectory })
      yield* strategy(id).remove({ directory: copyDirectory, force: input.force })
      yield* changed(input.projectID, yield* removeStored(input.projectID, copyDirectory))
    })

    const refresh = Effect.fn("ProjectCopy.refresh")(function* (input: RefreshInput) {
      const roots = yield* db
        .select({ directory: ProjectDirectoryTable.directory })
        .from(ProjectDirectoryTable)
        .where(
          and(
            eq(ProjectDirectoryTable.project_id, input.projectID),
            inArray(ProjectDirectoryTable.type, ["main", "root"]),
          ),
        )
        .all()
        .pipe(Effect.orDie)
      const sourceDirectories = yield* Effect.forEach(roots, (item) => canonical(AbsolutePath.make(item.directory)), {
        concurrency: "unbounded",
      })
      const discovered = yield* Effect.forEach(
        sourceDirectories,
        (sourceDirectory) =>
          Effect.forEach(registry.values(), (strategy) =>
            strategy
              .list(sourceDirectory)
              .pipe(Effect.map((items) => items.map((item) => ({ ...item, type: strategy.id })))),
          ),
        { concurrency: "unbounded" },
      ).pipe(
        Effect.map((sets) => new Map(sets.flat(2).map((item) => [item.directory, item] as const)).values().toArray()),
      )
      const stored = yield* db
        .select({ directory: ProjectDirectoryTable.directory })
        .from(ProjectDirectoryTable)
        .where(eq(ProjectDirectoryTable.project_id, input.projectID))
        .all()
        .pipe(Effect.orDie)
      const inserted = yield* Effect.forEach(discovered, (item) =>
        insert(input.projectID, item.directory, item.type),
      ).pipe(Effect.map((items) => items.some(Boolean)))
      const removed = yield* Effect.forEach(stored, (item) =>
        fs
          .isDir(item.directory)
          .pipe(
            Effect.flatMap((exists) =>
              exists ? Effect.succeed(false) : removeStored(input.projectID, AbsolutePath.make(item.directory)),
            ),
          ),
      ).pipe(Effect.map((items) => items.some(Boolean)))
      yield* changed(input.projectID, inserted || removed)
    })

    return Service.of({ detect, create, remove, refresh })
  }),
)

export const defaultLayer = layer.pipe(
  Layer.provide(Database.defaultLayer),
  Layer.provide(FSUtil.defaultLayer),
  Layer.provide(Git.defaultLayer),
  Layer.provide(EventV2.defaultLayer),
)
