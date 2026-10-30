export * as ProjectOperations from "./project.js"

import { Context, Effect, Layer } from "effect"
import { eq, like, or } from "drizzle-orm"
import { FSUtil } from "@opencode/util/fs-util"
import { Hash } from "@opencode/util/hash"
import { makeGlobalNode } from "@opencode/util/effect/app-node"
import { Database } from "../database/database.js"
import { ProjectTable } from "../project/sql.js"
import { WorktreeTable } from "../worktree/sql.js"
import { Project, NotFoundError } from "../project.js"
import { Project as ProjectSchema } from "@opencode/schema/project"
import { ProjectWorkspace } from "@opencode/schema/project-workspace"
import { AbsolutePath } from "../schema.js"
import { Bus } from "../bus.js"

export interface Interface {
  readonly create: (input: ProjectWorkspace.CreateProjectInput) => Effect.Effect<Project.Info>
  readonly rename: (projectID: Project.ID, newName: string) => Effect.Effect<Project.Info, NotFoundError>
  readonly archive: (projectID: Project.ID) => Effect.Effect<boolean, NotFoundError>
  readonly restore: (projectID: Project.ID) => Effect.Effect<boolean, NotFoundError>
  readonly delete: (input: ProjectWorkspace.DeleteProjectInput) => Effect.Effect<boolean, NotFoundError>
  readonly search: (query: string) => Effect.Effect<ReadonlyArray<Project.Info>>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/ProjectOperations") {}

function fromRow(row: typeof ProjectTable.$inferSelect): Project.Info {
  return {
    id: row.id,
    canonical: row.worktree,
    vcs: row.vcs ? (row.vcs as any) : undefined,
    name: row.name ?? undefined,
    icon:
      row.icon_url || row.icon_url_override || row.icon_color
        ? {
            url: row.icon_url ?? undefined,
            override: row.icon_url_override ?? undefined,
            color: row.icon_color ?? undefined,
          }
        : undefined,
    commands: row.commands ?? undefined,
    time: {
      created: row.time_created,
      updated: row.time_updated,
      active: row.time_active,
      archived: row.time_archived ?? undefined,
    },
    sandboxes: row.sandboxes,
  }
}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const db = (yield* Database.Service).db
    const fs = yield* FSUtil.Service
    const bus = yield* Bus.Service

    return Service.of({
      create: Effect.fn("ProjectOperations.create")(function* (input) {
        const resolvedPath = AbsolutePath.make(yield* fs.resolve(input.directory))
        yield* fs.ensureDir(resolvedPath).pipe(Effect.ignore)

        const id = Project.ID.make(Hash.fast(`project:${resolvedPath}`))
        const now = Date.now()

        const row = yield* db
          .insert(ProjectTable)
          .values({
            id,
            worktree: resolvedPath,
            name: input.name,
            commands: input.commands,
            icon_url: input.icon?.url,
            icon_url_override: input.icon?.override,
            icon_color: input.icon?.color,
            time_created: now,
            time_updated: now,
            time_active: now,
            sandboxes: [],
          })
          .onConflictDoUpdate({
            target: ProjectTable.id,
            set: {
              name: input.name,
              time_updated: now,
            },
          })
          .returning()
          .get()
          .pipe(Effect.orDie)

        yield* db
          .insert(WorktreeTable)
          .values({
            project_id: id,
            directory: resolvedPath,
            time_created: now,
          })
          .onConflictDoNothing()
          .run()
          .pipe(Effect.orDie)

        const info = fromRow(row!)
        yield* bus.publish(ProjectSchema.Event.Updated, info).pipe(Effect.ignore)
        return info
      }),

      rename: Effect.fn("ProjectOperations.rename")(function* (projectID, newName) {
        const row = yield* db
          .update(ProjectTable)
          .set({ name: newName, time_updated: Date.now() })
          .where(eq(ProjectTable.id, projectID))
          .returning()
          .get()
          .pipe(Effect.orDie)

        if (!row) {
          return yield* Effect.fail(new NotFoundError({ projectID }))
        }

        const info = fromRow(row)
        yield* bus.publish(ProjectSchema.Event.Updated, info).pipe(Effect.ignore)
        return info
      }),

      archive: Effect.fn("ProjectOperations.archive")(function* (projectID) {
        const row = yield* db
          .update(ProjectTable)
          .set({ time_archived: Date.now(), time_updated: Date.now() })
          .where(eq(ProjectTable.id, projectID))
          .returning()
          .get()
          .pipe(Effect.orDie)

        if (!row) {
          return yield* Effect.fail(new NotFoundError({ projectID }))
        }

        yield* bus.publish(ProjectSchema.Event.Updated, fromRow(row)).pipe(Effect.ignore)
        return true
      }),

      restore: Effect.fn("ProjectOperations.restore")(function* (projectID) {
        const row = yield* db
          .update(ProjectTable)
          .set({ time_archived: null, time_updated: Date.now() })
          .where(eq(ProjectTable.id, projectID))
          .returning()
          .get()
          .pipe(Effect.orDie)

        if (!row) {
          return yield* Effect.fail(new NotFoundError({ projectID }))
        }

        yield* bus.publish(ProjectSchema.Event.Updated, fromRow(row)).pipe(Effect.ignore)
        return true
      }),

      delete: Effect.fn("ProjectOperations.delete")(function* (input) {
        const row = yield* db
          .select()
          .from(ProjectTable)
          .where(eq(ProjectTable.id, input.projectID))
          .get()
          .pipe(Effect.orDie)

        if (!row) {
          return yield* Effect.fail(new NotFoundError({ projectID: input.projectID }))
        }

        yield* db.delete(ProjectTable).where(eq(ProjectTable.id, input.projectID)).run().pipe(Effect.orDie)

        if (input.deletePhysicalFiles === true) {
          yield* fs.remove(row.worktree, { recursive: true }).pipe(Effect.ignore)
        }

        return true
      }),

      search: Effect.fn("ProjectOperations.search")(function* (query) {
        const pattern = `%${query}%`
        const rows = yield* db
          .select()
          .from(ProjectTable)
          .where(
            or(
              like(ProjectTable.name, pattern),
              like(ProjectTable.worktree, pattern),
            ),
          )
          .all()
          .pipe(Effect.orDie)

        return rows.map(fromRow)
      }),
    })
  }),
)

export const node = makeGlobalNode({
  service: Service,
  layer,
  deps: [Bus.node, Database.node, FSUtil.node],
})
