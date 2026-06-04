import { and, asc, eq, inArray } from "drizzle-orm"
import { Database } from "@opencode-ai/core/database/database"
import { EventV2 } from "@opencode-ai/core/event"
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
  position: NonNegativeInt,
  expanded: Schema.Boolean,
}).annotate({ identifier: "UiProjectViewEntry" })
export type Entry = Schema.Schema.Type<typeof Entry>

export const Info = Schema.Struct({
  projects: Schema.Array(Entry),
  lastProject: optionalOmitUndefined(Project.Info),
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
  readonly closeProject: (projectID: ProjectV2.ID) => Effect.Effect<Info>
  readonly setLastProject: (
    input: LastProjectInput,
  ) => Effect.Effect<Info, InvalidProjectRefError | ProjectNotFoundError>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/UiProjectView") {}

type Db = Database.Interface["db"]
type Transaction = Parameters<Parameters<Db["transaction"]>[0]>[0]
type DatabaseLike = Db | Transaction
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

    const getProjectID = Effect.fn("UiProjectView.getProjectID")(function* (input: ProjectRef) {
      if (input.projectID) return input.projectID
      if (input.directory) return (yield* project.fromDirectory(input.directory)).project.id
      return yield* new InvalidProjectRefError({ message: "Expected projectID or directory" })
    })

    const requireProject = Effect.fn("UiProjectView.requireProject")(function* (projectID: ProjectV2.ID) {
      const row = yield* db.select().from(ProjectTable).where(eq(ProjectTable.id, projectID)).get().pipe(Effect.orDie)
      if (!row) return yield* new ProjectNotFoundError({ projectID })
      return Project.fromRow(row)
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
        .select({ project: ProjectTable })
        .from(UiProjectViewLastProjectTable)
        .innerJoin(ProjectTable, eq(UiProjectViewLastProjectTable.project_id, ProjectTable.id))
        .where(eq(UiProjectViewLastProjectTable.view_id, defaultViewID))
        .get()
        .pipe(Effect.orDie)
      return {
        projects: rows.map((row) => ({
          project: Project.fromRow(row.project),
          position: row.open.position,
          expanded: row.open.expanded,
        })),
        ...(last ? { lastProject: Project.fromRow(last.project) } : {}),
      } satisfies Info
    })

    const replaceRows = (d: DatabaseLike, rows: { projectID: ProjectV2.ID; expanded: boolean }[]) =>
      Effect.gen(function* () {
        yield* ensureView(d).pipe(Effect.orDie)
        if (rows.length > 0) {
          const existing = yield* d
            .select({ id: ProjectTable.id })
            .from(ProjectTable)
            .where(
              inArray(
                ProjectTable.id,
                rows.map((row) => row.projectID),
              ),
            )
            .all()
            .pipe(Effect.orDie)
          const existingIDs = new Set(existing.map((row) => row.id))
          const missing = rows.find((row) => !existingIDs.has(row.projectID))
          if (missing) return yield* new ProjectNotFoundError({ projectID: missing.projectID })
        }
        const oldRows = yield* d
          .select()
          .from(UiOpenProjectTable)
          .where(eq(UiOpenProjectTable.view_id, defaultViewID))
          .all()
          .pipe(Effect.orDie)
        const created = new Map(oldRows.map((row) => [row.project_id, row.time_created]))
        yield* d
          .delete(UiOpenProjectTable)
          .where(eq(UiOpenProjectTable.view_id, defaultViewID))
          .run()
          .pipe(Effect.orDie)
        const now = Date.now()
        if (rows.length > 0)
          yield* d
            .insert(UiOpenProjectTable)
            .values(
              rows.map((row, position) => ({
                view_id: defaultViewID,
                project_id: row.projectID,
                position,
                expanded: row.expanded,
                time_created: created.get(row.projectID) ?? now,
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
        (row, index) => input.projects.findIndex((item) => item.projectID === row.projectID) !== index,
      )
      if (duplicate) return yield* new InvalidProjectRefError({ message: `Duplicate projectID: ${duplicate.projectID}` })
      const result = yield* db
        .transaction((tx) =>
          Effect.gen(function* () {
            const previous = yield* tx
              .select()
              .from(UiOpenProjectTable)
              .where(eq(UiOpenProjectTable.view_id, defaultViewID))
              .all()
              .pipe(Effect.orDie)
            const expanded = new Map(previous.map((row) => [row.project_id, row.expanded]))
            yield* replaceRows(
              tx,
              input.projects.map((row) => ({
                projectID: row.projectID,
                expanded: row.expanded ?? expanded.get(row.projectID) ?? true,
              })),
            )
            const removedProjectIDs = previous
              .filter((row) => !input.projects.some((project) => project.projectID === row.project_id))
              .map((row) => row.project_id)
            if (removedProjectIDs.length > 0)
              yield* tx
                .delete(UiProjectViewLastProjectTable)
                .where(
                  and(
                    eq(UiProjectViewLastProjectTable.view_id, defaultViewID),
                    inArray(UiProjectViewLastProjectTable.project_id, removedProjectIDs),
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
      const projectID = yield* getProjectID(input)
      yield* requireProject(projectID)
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
            const existing = current.find((row) => row.project_id === projectID)
            const without = current.filter((row) => row.project_id !== projectID)
            const position = Math.min(input.position ?? without.length, without.length)
            const next = without.toSpliced(position, 0, {
              view_id: defaultViewID,
              project_id: projectID,
              position,
              expanded: input.expanded ?? existing?.expanded ?? true,
              time_created: existing?.time_created ?? Date.now(),
              time_updated: Date.now(),
            })
            yield* replaceRows(
              tx,
              next.map((row) => ({ projectID: row.project_id, expanded: row.expanded })),
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
            const existing = current.find((row) => row.project_id === projectID)
            if (!existing) return yield* new ProjectNotFoundError({ projectID })
            const without = current.filter((row) => row.project_id !== projectID)
            const position = input.position === undefined ? existing.position : Math.min(input.position, without.length)
            const next = without.toSpliced(position, 0, { ...existing, expanded: input.expanded ?? existing.expanded })
            yield* replaceRows(
              tx,
              next.map((row) => ({ projectID: row.project_id, expanded: row.expanded })),
            )
            return yield* read(tx)
          }),
        )
        .pipe(Effect.catchTag("SqlError", (error) => Effect.die(error)))
      yield* emitUpdated()
      return result
    })

    const closeProject = Effect.fn("UiProjectView.closeProject")(function* (projectID: ProjectV2.ID) {
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
            yield* replaceRows(
              tx,
              current
                .filter((row) => row.project_id !== projectID)
                .map((row) => ({ projectID: row.project_id, expanded: row.expanded })),
            )
            yield* tx
              .delete(UiProjectViewLastProjectTable)
              .where(
                and(
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
      const projectID = yield* getProjectID(input)
      yield* requireProject(projectID)
      const result = yield* db
        .transaction((tx) =>
          Effect.gen(function* () {
            yield* ensureView(tx).pipe(Effect.orDie)
            yield* tx
              .insert(UiProjectViewLastProjectTable)
              .values({ view_id: defaultViewID, project_id: projectID, time_updated: Date.now() })
              .onConflictDoUpdate({
                target: UiProjectViewLastProjectTable.view_id,
                set: { project_id: projectID, time_updated: Date.now() },
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
