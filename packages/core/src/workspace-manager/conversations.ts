export * as ProjectConversations from "./conversations.js"

import { Context, Effect, Layer } from "effect"
import { eq, and, desc, isNull, sql } from "drizzle-orm"
import { makeGlobalNode } from "@opencode/util/effect/app-node"
import { Database } from "../database/database.js"
import { SessionTable, SessionMessageTable } from "../session/sql.js"
import { ProjectTable } from "../project/sql.js"
import { Project } from "@opencode/schema/project"
import { Session } from "@opencode/schema/session"
import { ProjectWorkspace } from "@opencode/schema/project-workspace"
import { Hash } from "@opencode/util/hash"

export interface Interface {
  readonly list: (projectID: Project.ID, includeArchived?: boolean) => Effect.Effect<ReadonlyArray<ProjectWorkspace.ProjectConversation>>
  readonly create: (projectID: Project.ID, title?: string) => Effect.Effect<ProjectWorkspace.ProjectConversation, Error>
  readonly rename: (sessionID: Session.ID, title: string) => Effect.Effect<boolean>
  readonly archive: (sessionID: Session.ID) => Effect.Effect<boolean>
  readonly restore: (sessionID: Session.ID) => Effect.Effect<boolean>
  readonly delete: (sessionID: Session.ID) => Effect.Effect<boolean>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/ProjectConversations") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const db = (yield* Database.Service).db

    return Service.of({
      list: Effect.fn("ProjectConversations.list")(function* (projectID, includeArchived = false) {
        const rows = yield* db
          .select({
            id: SessionTable.id,
            projectID: SessionTable.project_id,
            title: SessionTable.title,
            timeCreated: SessionTable.time_created,
            timeUpdated: SessionTable.time_updated,
            timeArchived: SessionTable.time_archived,
          })
          .from(SessionTable)
          .where(
            and(
              eq(SessionTable.project_id, projectID),
              isNull(SessionTable.parent_id),
              includeArchived ? undefined : isNull(SessionTable.time_archived),
            ),
          )
          .orderBy(desc(SessionTable.time_updated))
          .all()
          .pipe(Effect.orDie)

        const conversations: ProjectWorkspace.ProjectConversation[] = []

        for (const row of rows) {
          const msgCountResult = yield* db
            .select({ count: sql<number>`count(*)` })
            .from(SessionMessageTable)
            .where(eq(SessionMessageTable.session_id, row.id))
            .get()
            .pipe(Effect.orDie)

          conversations.push({
            sessionID: row.id,
            projectID: row.projectID,
            title: row.title ?? `Conversation ${row.id.slice(0, 8)}`,
            createdAt: row.timeCreated,
            updatedAt: row.timeUpdated,
            messageCount: msgCountResult?.count ?? 0,
            status: row.timeArchived ? "archived" : "active",
          })
        }

        return conversations
      }),

      create: Effect.fn("ProjectConversations.create")(function* (projectID, title) {
        const project = yield* db
          .select()
          .from(ProjectTable)
          .where(eq(ProjectTable.id, projectID))
          .get()
          .pipe(Effect.orDie)

        if (!project) {
          return yield* Effect.fail(new Error(`Project not found: ${projectID}`))
        }

        const id = Session.ID.make(`ses_${Hash.fast(`session:${Date.now()}:${Math.random()}`)}`)
        const now = Date.now()
        const convTitle = title ?? `Conversation ${new Date(now).toLocaleDateString()}`

        yield* db
          .insert(SessionTable)
          .values({
            id,
            project_id: projectID,
            slug: id.slice(0, 12),
            directory: project.worktree,
            title: convTitle,
            version: "2.3.0",
            time_created: now,
            time_updated: now,
          })
          .run()
          .pipe(Effect.orDie)

        return {
          sessionID: id,
          projectID,
          title: convTitle,
          createdAt: now,
          updatedAt: now,
          messageCount: 0,
          status: "active",
        }
      }),

      rename: Effect.fn("ProjectConversations.rename")(function* (sessionID, title) {
        yield* db
          .update(SessionTable)
          .set({ title, time_updated: Date.now() })
          .where(eq(SessionTable.id, sessionID))
          .run()
          .pipe(Effect.orDie)

        return true
      }),

      archive: Effect.fn("ProjectConversations.archive")(function* (sessionID) {
        yield* db
          .update(SessionTable)
          .set({ time_archived: Date.now(), time_updated: Date.now() })
          .where(eq(SessionTable.id, sessionID))
          .run()
          .pipe(Effect.orDie)

        return true
      }),

      restore: Effect.fn("ProjectConversations.restore")(function* (sessionID) {
        yield* db
          .update(SessionTable)
          .set({ time_archived: null, time_updated: Date.now() })
          .where(eq(SessionTable.id, sessionID))
          .run()
          .pipe(Effect.orDie)

        return true
      }),

      delete: Effect.fn("ProjectConversations.delete")(function* (sessionID) {
        yield* db
          .delete(SessionTable)
          .where(eq(SessionTable.id, sessionID))
          .run()
          .pipe(Effect.orDie)

        return true
      }),
    })
  }),
)

export const node = makeGlobalNode({
  service: Service,
  layer,
  deps: [Database.node],
})
