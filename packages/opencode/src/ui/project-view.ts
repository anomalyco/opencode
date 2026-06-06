import { and, asc, eq, inArray } from "drizzle-orm"
import { Database } from "@opencode-ai/core/database/database"
import { EventV2 } from "@opencode-ai/core/event"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { ProjectV2 } from "@opencode-ai/core/project"
import { ProjectTable } from "@opencode-ai/core/project/sql"
import { NonNegativeInt, optionalOmitUndefined } from "@opencode-ai/core/schema"
import {
  UiOpenProjectTable,
  UiProjectViewLastProjectTable,
  UiProjectViewTable,
} from "@opencode-ai/core/ui/project-view.sql"
import { Context, Effect, Layer, Schema } from "effect"
import { Project } from "@/project/project"
import { GlobalBus } from "@/bus/global"

const defaultViewID = "default"

export const Entry = Schema.Struct({
  project: Project.Info,
  directory: Schema.String,
  position: NonNegativeInt,
  expanded: Schema.Boolean,
}).annotate({ identifier: "UiProjectViewEntry" })
export type Entry = Schema.Schema.Type<typeof Entry>

export const Info = Schema.Struct({
  projects: Schema.Array(Entry),
  lastProject: optionalOmitUndefined(Project.Info),
  lastProjectDirectory: optionalOmitUndefined(Schema.String),
}).annotate({ identifier: "UiProjectView" })
export type Info = Schema.Schema.Type<typeof Info>

export const ProjectRef = Schema.Struct({
  projectID: optionalOmitUndefined(ProjectV2.ID),
  directory: optionalOmitUndefined(Schema.String),
}).annotate({ identifier: "UiProjectRef" })
export type ProjectRef = Schema.Schema.Type<typeof ProjectRef>

export const ReplaceOpenProjectsInput = Schema.Struct({
  projects: Schema.Array(
    Schema.Struct({
      projectID: ProjectV2.ID,
      directory: optionalOmitUndefined(Schema.String),
      expanded: optionalOmitUndefined(Schema.Boolean),
    }),
  ),
}).annotate({ identifier: "UiProjectViewReplaceOpenProjectsInput" })
export type ReplaceOpenProjectsInput = Schema.Schema.Type<typeof ReplaceOpenProjectsInput>

export const OpenProjectInput = Schema.Struct({
  projectID: optionalOmitUndefined(ProjectV2.ID),
  directory: optionalOmitUndefined(Schema.String),
  position: optionalOmitUndefined(NonNegativeInt),
  expanded: optionalOmitUndefined(Schema.Boolean),
}).annotate({ identifier: "UiProjectViewOpenProjectInput" })
export type OpenProjectInput = Schema.Schema.Type<typeof OpenProjectInput>

export const UpdateOpenProjectInput = Schema.Struct({
  directory: optionalOmitUndefined(Schema.String),
  expanded: optionalOmitUndefined(Schema.Boolean),
  position: optionalOmitUndefined(NonNegativeInt),
}).annotate({ identifier: "UiProjectViewUpdateOpenProjectInput" })
export type UpdateOpenProjectInput = Schema.Schema.Type<typeof UpdateOpenProjectInput>

export const LastProjectInput = ProjectRef.annotate({ identifier: "UiProjectViewLastProjectInput" })
export type LastProjectInput = ProjectRef

export const Event = {
  Updated: EventV2.define({
    type: "ui.project_view.updated",
    schema: { viewID: Schema.String },
  }),
}

export class InvalidProjectRefError extends Schema.TaggedErrorClass<InvalidProjectRefError>()(
  "UiProjectView.InvalidProjectRefError",
  { message: Schema.String },
) {}

export class ProjectNotFoundError extends Schema.TaggedErrorClass<ProjectNotFoundError>()(
  "UiProjectView.ProjectNotFoundError",
  { projectID: ProjectV2.ID },
) {}

export interface Interface {
  readonly get: () => Effect.Effect<Info>
  readonly replaceOpenProjects: (
    input: ReplaceOpenProjectsInput,
  ) => Effect.Effect<Info, InvalidProjectRefError | ProjectNotFoundError>
  readonly openProject: (input: OpenProjectInput) => Effect.Effect<Info, InvalidProjectRefError | ProjectNotFoundError>
  readonly updateOpenProject: (
    projectID: ProjectV2.ID,
    input: UpdateOpenProjectInput,
  ) => Effect.Effect<Info, ProjectNotFoundError>
  readonly closeProject: (projectID: ProjectV2.ID, directory?: string) => Effect.Effect<Info>
  readonly setLastProject: (
    input: LastProjectInput,
  ) => Effect.Effect<Info, InvalidProjectRefError | ProjectNotFoundError>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/UiProjectView") {}

type Db = Database.Interface["db"]
type Transaction = Parameters<Parameters<Db["transaction"]>[0]>[0]
type DatabaseLike = Db | Transaction
type ReplaceOpenProjectsRow = ReplaceOpenProjectsInput["projects"][number]

function replaceOpenProjectsInputKey(row: ReplaceOpenProjectsRow) {
  if (row.directory) return `directory:${FSUtil.resolve(row.directory)}`
  return `project:${row.projectID}`
}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const { db } = yield* Database.Service
    const project = yield* Project.Service

    const emitUpdated = () =>
      Effect.sync(() =>
        GlobalBus.emit("event", {
          directory: "global",
          payload: {
            id: EventV2.ID.create(),
            type: Event.Updated.type,
            properties: { viewID: defaultViewID },
          },
        }),
      )

    const ensureView = (d: DatabaseLike) =>
      d
        .insert(UiProjectViewTable)
        .values({ id: defaultViewID, name: "Default", time_created: Date.now(), time_updated: Date.now() })
        .onConflictDoNothing()
        .run()

    const requireProject = Effect.fn("UiProjectView.requireProject")(function* (projectID: ProjectV2.ID) {
      const row = yield* db.select().from(ProjectTable).where(eq(ProjectTable.id, projectID)).get().pipe(Effect.orDie)
      if (!row) return yield* new ProjectNotFoundError({ projectID })
      return Project.fromRow(row)
    })

    const resolveProjectRef = Effect.fn("UiProjectView.resolveProjectRef")(function* (input: ProjectRef) {
      if (input.projectID) {
        const result = yield* requireProject(input.projectID)
        return { projectID: input.projectID, directory: input.directory ? FSUtil.resolve(input.directory) : result.worktree }
      }
      if (input.directory) {
        const result = yield* project.fromDirectory(input.directory)
        return { projectID: result.project.id, directory: FSUtil.resolve(input.directory) }
      }
      return yield* new InvalidProjectRefError({ message: "Expected projectID or directory" })
    })

    const read = Effect.fn("UiProjectView.read")(function* (d: DatabaseLike) {
      yield* ensureView(d).pipe(Effect.orDie)
      const rows = yield* d
        .select({ open: UiOpenProjectTable, project: ProjectTable })
        .from(UiOpenProjectTable)
        .innerJoin(ProjectTable, eq(UiOpenProjectTable.project_id, ProjectTable.id))
        .where(eq(UiOpenProjectTable.view_id, defaultViewID))
        .orderBy(asc(UiOpenProjectTable.position))
        .all()
        .pipe(Effect.orDie)
      const last = yield* d
        .select({ last: UiProjectViewLastProjectTable, project: ProjectTable })
        .from(UiProjectViewLastProjectTable)
        .innerJoin(ProjectTable, eq(UiProjectViewLastProjectTable.project_id, ProjectTable.id))
        .where(eq(UiProjectViewLastProjectTable.view_id, defaultViewID))
        .get()
        .pipe(Effect.orDie)
      return {
        projects: rows.map((row) => ({
          project: Project.fromRow(row.project),
          directory: row.open.directory ?? row.project.worktree,
          position: row.open.position,
          expanded: row.open.expanded,
        })),
        ...(last ? { lastProject: Project.fromRow(last.project), lastProjectDirectory: last.last.directory } : {}),
      } satisfies Info
    })

    const replaceRows = (d: DatabaseLike, rows: { projectID: ProjectV2.ID; expanded: boolean; directory?: string }[]) =>
      Effect.gen(function* () {
        yield* ensureView(d).pipe(Effect.orDie)
        const oldRows = yield* d
          .select()
          .from(UiOpenProjectTable)
          .where(eq(UiOpenProjectTable.view_id, defaultViewID))
          .orderBy(asc(UiOpenProjectTable.position))
          .all()
          .pipe(Effect.orDie)
        const previousByDirectory = new Map(oldRows.map((row) => [row.directory, row]))
        const previousByProjectID = new Map<ProjectV2.ID, (typeof oldRows)[number]>()
        for (const row of oldRows) {
          if (previousByProjectID.has(row.project_id)) continue
          previousByProjectID.set(row.project_id, row)
        }
        const existing = yield* (rows.length === 0
          ? Effect.succeed([])
          : d
              .select({ id: ProjectTable.id, worktree: ProjectTable.worktree })
              .from(ProjectTable)
              .where(
                inArray(
                  ProjectTable.id,
                  rows.map((row) => row.projectID),
                ),
              )
              .all()
              .pipe(Effect.orDie))
        const existingByID = new Map(existing.map((row) => [row.id, row]))
        if (rows.length > 0) {
          const missing = rows.find((row) => !existingByID.has(row.projectID))
          if (missing) return yield* new ProjectNotFoundError({ projectID: missing.projectID })
        }
        const resolvedRows = rows.map((row) => {
          const directory = row.directory ?? previousByProjectID.get(row.projectID)?.directory ?? existingByID.get(row.projectID)?.worktree
          if (!directory) throw new Error(`Unable to resolve opened project directory: ${row.projectID}`)
          return { ...row, directory: FSUtil.resolve(directory) }
        })
        yield* d
          .delete(UiOpenProjectTable)
          .where(eq(UiOpenProjectTable.view_id, defaultViewID))
          .run()
          .pipe(Effect.orDie)
        const now = Date.now()
        if (resolvedRows.length > 0)
          yield* d
            .insert(UiOpenProjectTable)
            .values(
              resolvedRows.map((row, position) => ({
                view_id: defaultViewID,
                project_id: row.projectID,
                directory: row.directory,
                position,
                expanded: row.expanded,
                time_created:
                  previousByDirectory.get(row.directory)?.time_created ??
                  previousByProjectID.get(row.projectID)?.time_created ??
                  now,
                time_updated: now,
              })),
            )
            .run()
            .pipe(Effect.orDie)
      })

    const replaceOpenProjects = Effect.fn("UiProjectView.replaceOpenProjects")(function* (
      input: ReplaceOpenProjectsInput,
    ) {
      const duplicate = input.projects.find(
        (row, index) =>
          input.projects.findIndex((item) => replaceOpenProjectsInputKey(item) === replaceOpenProjectsInputKey(row)) !==
          index,
      )
      if (duplicate)
        return yield* new InvalidProjectRefError({ message: `Duplicate opened project: ${duplicate.directory ?? duplicate.projectID}` })
      const result = yield* db
        .transaction((tx) =>
          Effect.gen(function* () {
            const previous = yield* tx
              .select()
              .from(UiOpenProjectTable)
              .where(eq(UiOpenProjectTable.view_id, defaultViewID))
              .all()
              .pipe(Effect.orDie)
            const expandedByDirectory = new Map(previous.map((row) => [row.directory, row.expanded]))
            const expandedByProjectID = new Map<ProjectV2.ID, boolean>()
            for (const row of previous) {
              if (expandedByProjectID.has(row.project_id)) continue
              expandedByProjectID.set(row.project_id, row.expanded)
            }
            yield* replaceRows(
              tx,
              input.projects.map((row) => ({
                projectID: row.projectID,
                directory: row.directory,
                expanded:
                  row.expanded ??
                  (row.directory ? expandedByDirectory.get(FSUtil.resolve(row.directory)) : undefined) ??
                  expandedByProjectID.get(row.projectID) ??
                  true,
              })),
            )
            const nextDirectories = new Set(
              input.projects.flatMap((project) => {
                if (project.directory) return [FSUtil.resolve(project.directory)]
                const previousRow = previous.find((row) => row.project_id === project.projectID)
                return previousRow ? [previousRow.directory] : []
              }),
            )
            const removedRows = previous.filter((row) => {
              if (nextDirectories.has(row.directory)) return false
              return true
            })
            if (removedRows.length > 0)
              yield* tx
                .delete(UiProjectViewLastProjectTable)
                .where(
                  and(
                    eq(UiProjectViewLastProjectTable.view_id, defaultViewID),
                    inArray(
                      UiProjectViewLastProjectTable.directory,
                      removedRows.map((row) => row.directory),
                    ),
                  ),
                )
                .run()
                .pipe(Effect.orDie)
            if (input.projects.length === 0)
              yield* tx
                .delete(UiProjectViewLastProjectTable)
                .where(eq(UiProjectViewLastProjectTable.view_id, defaultViewID))
                .run()
                .pipe(Effect.orDie)
            return yield* read(tx)
          }),
        )
        .pipe(Effect.catchTag("SqlError", (error) => Effect.die(error)))
      yield* emitUpdated()
      return result
    })

    const openProject = Effect.fn("UiProjectView.openProject")(function* (input: OpenProjectInput) {
      const ref = yield* resolveProjectRef(input)
      const projectID = ref.projectID
      const result = yield* db
        .transaction((tx) =>
          Effect.gen(function* () {
            const current = yield* tx
              .select()
              .from(UiOpenProjectTable)
              .where(eq(UiOpenProjectTable.view_id, defaultViewID))
              .orderBy(asc(UiOpenProjectTable.position))
              .all()
              .pipe(Effect.orDie)
            const existing = current.find((row) => row.directory === ref.directory)
            const without = current.filter((row) => row.directory !== ref.directory)
            const position = Math.min(input.position ?? without.length, without.length)
            const next = without.toSpliced(position, 0, {
              view_id: defaultViewID,
              project_id: projectID,
              directory: ref.directory,
              position,
              expanded: input.expanded ?? existing?.expanded ?? true,
              time_created: existing?.time_created ?? Date.now(),
              time_updated: Date.now(),
            })
            yield* replaceRows(
              tx,
              next.map((row) => ({ projectID: row.project_id, expanded: row.expanded, directory: row.directory })),
            )
            return yield* read(tx)
          }),
        )
        .pipe(Effect.catchTag("SqlError", (error) => Effect.die(error)))
      yield* emitUpdated()
      return result
    })

    const updateOpenProject = Effect.fn("UiProjectView.updateOpenProject")(function* (
      projectID: ProjectV2.ID,
      input: UpdateOpenProjectInput,
    ) {
      const result = yield* db
        .transaction((tx) =>
          Effect.gen(function* () {
            const current = yield* tx
              .select()
              .from(UiOpenProjectTable)
              .where(eq(UiOpenProjectTable.view_id, defaultViewID))
              .orderBy(asc(UiOpenProjectTable.position))
              .all()
              .pipe(Effect.orDie)
            const directory = input.directory ? FSUtil.resolve(input.directory) : undefined
            const existing = directory
              ? current.find((row) => row.project_id === projectID && row.directory === directory)
              : current.find((row) => row.project_id === projectID)
            if (!existing) return yield* new ProjectNotFoundError({ projectID })
            const without = current.filter((row) => row.directory !== existing.directory)
            const position = input.position === undefined ? existing.position : Math.min(input.position, without.length)
            const next = without.toSpliced(position, 0, { ...existing, expanded: input.expanded ?? existing.expanded })
            yield* replaceRows(
              tx,
              next.map((row) => ({ projectID: row.project_id, expanded: row.expanded, directory: row.directory })),
            )
            return yield* read(tx)
          }),
        )
        .pipe(Effect.catchTag("SqlError", (error) => Effect.die(error)))
      yield* emitUpdated()
      return result
    })

    const closeProject = Effect.fn("UiProjectView.closeProject")(function* (projectID: ProjectV2.ID, directory?: string) {
      const result = yield* db
        .transaction((tx) =>
          Effect.gen(function* () {
            const current = yield* tx
              .select()
              .from(UiOpenProjectTable)
              .where(eq(UiOpenProjectTable.view_id, defaultViewID))
              .orderBy(asc(UiOpenProjectTable.position))
              .all()
              .pipe(Effect.orDie)
            const resolvedDirectory = directory ? FSUtil.resolve(directory) : undefined
            yield* replaceRows(
              tx,
              current
                .filter((row) =>
                  resolvedDirectory
                    ? row.project_id !== projectID || row.directory !== resolvedDirectory
                    : row.project_id !== projectID,
                )
                .map((row) => ({ projectID: row.project_id, expanded: row.expanded, directory: row.directory })),
            )
            yield* tx
              .delete(UiProjectViewLastProjectTable)
              .where(
                resolvedDirectory
                  ? and(
                      eq(UiProjectViewLastProjectTable.view_id, defaultViewID),
                      eq(UiProjectViewLastProjectTable.project_id, projectID),
                      eq(UiProjectViewLastProjectTable.directory, resolvedDirectory),
                    )
                  : and(
                      eq(UiProjectViewLastProjectTable.view_id, defaultViewID),
                      eq(UiProjectViewLastProjectTable.project_id, projectID),
                    ),
              )
              .run()
              .pipe(Effect.orDie)
            return yield* read(tx)
          }),
        )
        .pipe(Effect.orDie)
      yield* emitUpdated()
      return result
    })

    const setLastProject = Effect.fn("UiProjectView.setLastProject")(function* (input: LastProjectInput) {
      const ref = yield* resolveProjectRef(input)
      const projectID = ref.projectID
      const result = yield* db
        .transaction((tx) =>
          Effect.gen(function* () {
            yield* ensureView(tx).pipe(Effect.orDie)
            yield* tx
              .insert(UiProjectViewLastProjectTable)
              .values({ view_id: defaultViewID, project_id: projectID, directory: ref.directory, time_updated: Date.now() })
              .onConflictDoUpdate({
                target: UiProjectViewLastProjectTable.view_id,
                set: { project_id: projectID, directory: ref.directory, time_updated: Date.now() },
              })
              .run()
              .pipe(Effect.orDie)
            return yield* read(tx)
          }),
        )
        .pipe(Effect.orDie)
      yield* emitUpdated()
      return result
    })

    const get = Effect.fn("UiProjectView.get")(function* () {
      return yield* read(db)
    })

    return Service.of({ get, replaceOpenProjects, openProject, updateOpenProject, closeProject, setLastProject })
  }),
)

export const defaultLayer = layer.pipe(
  Layer.provide(Project.defaultLayer),
  Layer.provide(Database.defaultLayer),
)

export const UiProjectView = {
  Entry,
  Info,
  ProjectRef,
  ReplaceOpenProjectsInput,
  OpenProjectInput,
  UpdateOpenProjectInput,
  LastProjectInput,
  Event,
  InvalidProjectRefError,
  ProjectNotFoundError,
  Service,
  layer,
  defaultLayer,
}
