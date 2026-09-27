export * as Artifact from "./artifact"

import { and, asc, desc, eq, inArray } from "drizzle-orm"
import { Context, Effect, Exit, Layer, Schema } from "effect"
import { Artifact } from "@opencode-ai/schema/artifact"
import { ArtifactCommentTable, ArtifactTable } from "./artifact/sql"
import { Database } from "./database/database"
import { makeGlobalNode } from "./effect/app-node"
import { ProjectV2 } from "./project"
import { SessionV2 } from "./session"
import { SessionSchema } from "./session/schema"
import { SessionTable } from "./session/sql"

export const ID = Artifact.ID
export type ID = typeof ID.Type

export const Info = Artifact.Info
export type Info = typeof Info.Type

export const Comment = Artifact.Comment
export type Comment = typeof Comment.Type

export const Type = Artifact.Type
export type Type = typeof Type.Type

export const Status = Artifact.Status
export type Status = typeof Status.Type

export class NotFoundError extends Schema.TaggedErrorClass<NotFoundError>()("Artifact.NotFoundError", {
  artifactID: Artifact.ID,
}) {}

export const ListInput = Schema.Struct({
  projectID: ProjectV2.ID.pipe(Schema.optional),
  sessionID: SessionSchema.ID.pipe(Schema.optional),
  type: Artifact.Type.pipe(Schema.optional),
  status: Artifact.Status.pipe(Schema.optional),
  agent: Schema.String.pipe(Schema.optional),
  task: Schema.String.pipe(Schema.optional),
}).annotate({ identifier: "Artifact.ListInput" })
export type ListInput = typeof ListInput.Type

export const CreateInput = Schema.Struct({
  projectID: ProjectV2.ID,
  sessionID: SessionSchema.ID.pipe(Schema.optional),
  name: Schema.String,
  type: Artifact.Type,
  status: Artifact.Status.pipe(Schema.optional),
  agent: Schema.String.pipe(Schema.optional),
  task: Schema.String.pipe(Schema.optional),
  content: Schema.String,
  diff: Schema.String.pipe(Schema.optional),
}).annotate({ identifier: "Artifact.CreateInput" })
export type CreateInput = typeof CreateInput.Type

export const UpdateInput = Schema.Struct({
  id: ID,
  name: Schema.String.pipe(Schema.optional),
  status: Artifact.Status.pipe(Schema.optional),
  agent: Schema.String.pipe(Schema.optional),
  task: Schema.String.pipe(Schema.optional),
  content: Schema.String.pipe(Schema.optional),
  diff: Schema.String.pipe(Schema.optional),
}).annotate({ identifier: "Artifact.UpdateInput" })
export type UpdateInput = typeof UpdateInput.Type

export const CommentInput = Schema.Struct({
  id: ID,
  author: Schema.String,
  body: Schema.String,
}).annotate({ identifier: "Artifact.CommentInput" })
export type CommentInput = typeof CommentInput.Type

export interface Interface {
  readonly create: (input: CreateInput) => Effect.Effect<Info, SessionV2.NotFoundError>
  readonly get: (id: ID) => Effect.Effect<Info, NotFoundError>
  readonly list: (input?: ListInput) => Effect.Effect<ReadonlyArray<Info>>
  readonly update: (input: UpdateInput) => Effect.Effect<Info, NotFoundError>
  // Comment delivery reaches the session at call time, so only this method
  // requires SessionV2; the service itself stays buildable with Database alone.
  readonly comment: (
    input: CommentInput,
  ) => Effect.Effect<{ readonly comment: Comment; readonly delivered: boolean }, NotFoundError, SessionV2.Service>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/v2/Artifact") {}

type Row = typeof ArtifactTable.$inferSelect
type CommentRow = typeof ArtifactCommentTable.$inferSelect

const toComment = (row: CommentRow): Comment => ({
  id: row.id,
  author: row.author,
  body: row.body,
  timeCreated: row.time_created,
})

const toInfo = (row: Row, comments: ReadonlyArray<Comment>): Info => ({
  id: row.id,
  projectID: row.project_id,
  ...(row.session_id !== null ? { sessionID: row.session_id } : {}),
  name: row.name,
  type: row.type,
  status: row.status,
  version: row.version,
  ...(row.agent !== null ? { agent: row.agent } : {}),
  ...(row.task !== null ? { task: row.task } : {}),
  content: row.content,
  ...(row.diff !== null ? { diff: row.diff } : {}),
  timeCreated: row.time_created,
  timeUpdated: row.time_updated,
  comments,
})

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const { db } = yield* Database.Service

    // Loads comments for a batch of artifacts in one query, grouped by artifact
    // in insertion order (ascending ids are time ordered).
    const commentsOf = Effect.fn("Artifact.commentsOf")(function* (ids: ReadonlyArray<Artifact.ID>) {
      const grouped = new Map<Artifact.ID, ReadonlyArray<Comment>>()
      if (ids.length === 0) return grouped
      const rows = yield* db
        .select()
        .from(ArtifactCommentTable)
        .where(inArray(ArtifactCommentTable.artifact_id, ids))
        .orderBy(asc(ArtifactCommentTable.time_created), asc(ArtifactCommentTable.id))
        .all()
        .pipe(Effect.orDie)
      for (const row of rows) {
        const list = grouped.get(row.artifact_id) ?? []
        grouped.set(row.artifact_id, [...list, toComment(row)])
      }
      return grouped
    })

    const get = Effect.fn("Artifact.get")(function* (id: ID) {
      const rows = yield* db.select().from(ArtifactTable).where(eq(ArtifactTable.id, id)).all().pipe(Effect.orDie)
      const row = rows[0]
      if (row === undefined) return yield* new NotFoundError({ artifactID: id })
      const grouped = yield* commentsOf([id])
      return toInfo(row, grouped.get(id) ?? [])
    })

    const create = Effect.fn("Artifact.create")(function* (input: CreateInput) {
      // A linked session must exist now: it is the delivery target for human
      // comments, so admitting an artifact that references a missing session
      // would silently drop every future comment. Reading the session table
      // directly keeps create requirement-free for agent tool callers.
      if (input.sessionID !== undefined) {
        const sessions = yield* db
          .select({ id: SessionTable.id })
          .from(SessionTable)
          .where(eq(SessionTable.id, input.sessionID))
          .all()
          .pipe(Effect.orDie)
        if (sessions.length === 0) return yield* new SessionV2.NotFoundError({ sessionID: input.sessionID })
      }
      const id = Artifact.ID.create()
      yield* db
        .insert(ArtifactTable)
        .values({
          id,
          project_id: input.projectID,
          session_id: input.sessionID ?? null,
          name: input.name,
          type: input.type,
          status: input.status ?? "draft",
          version: 1,
          agent: input.agent ?? null,
          task: input.task ?? null,
          content: input.content,
          diff: input.diff ?? null,
        })
        .run()
        .pipe(Effect.orDie)
      // The row was just written; a missing row is an invariant violation, not
      // a typed lookup failure, so surface it as a defect rather than widening
      // the typed error channel of create.
      return yield* get(id).pipe(Effect.orDie)
    })

    const list = Effect.fn("Artifact.list")(function* (input?: ListInput) {
      const rows = yield* db
        .select()
        .from(ArtifactTable)
        .where(
          and(
            input?.projectID ? eq(ArtifactTable.project_id, input.projectID) : undefined,
            input?.sessionID ? eq(ArtifactTable.session_id, input.sessionID) : undefined,
            input?.type ? eq(ArtifactTable.type, input.type) : undefined,
            input?.status ? eq(ArtifactTable.status, input.status) : undefined,
            input?.agent ? eq(ArtifactTable.agent, input.agent) : undefined,
            input?.task ? eq(ArtifactTable.task, input.task) : undefined,
          ),
        )
        .orderBy(desc(ArtifactTable.time_created), desc(ArtifactTable.id))
        .all()
        .pipe(Effect.orDie)
      const grouped = yield* commentsOf(rows.map((row) => row.id))
      return rows.map((row) => toInfo(row, grouped.get(row.id) ?? []))
    })

    const update = Effect.fn("Artifact.update")(function* (input: UpdateInput) {
      const existing = yield* get(input.id)
      yield* db
        .update(ArtifactTable)
        .set({
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.status !== undefined ? { status: input.status } : {}),
          ...(input.agent !== undefined ? { agent: input.agent } : {}),
          ...(input.task !== undefined ? { task: input.task } : {}),
          ...(input.content !== undefined ? { content: input.content } : {}),
          ...(input.diff !== undefined ? { diff: input.diff } : {}),
          // Every update is a new version; time_updated advances via Timestamps.
          version: existing.version + 1,
        })
        .where(eq(ArtifactTable.id, input.id))
        .run()
        .pipe(Effect.orDie)
      return yield* get(input.id)
    })

    const comment = Effect.fn("Artifact.comment")(function* (input: CommentInput) {
      const session = yield* SessionV2.Service
      const artifact = yield* get(input.id)
      const now = Date.now()
      const id = Artifact.CommentID.create()
      yield* db
        .insert(ArtifactCommentTable)
        .values({
          id,
          artifact_id: input.id,
          author: input.author,
          body: input.body,
          time_created: now,
          time_updated: now,
        })
        .run()
        .pipe(Effect.orDie)

      const stored: Comment = { id, author: input.author, body: input.body, timeCreated: now }
      if (artifact.sessionID === undefined) return { comment: stored, delivered: false }

      // Deliver as a steer so the comment promotes at the next safe
      // provider-turn boundary (waking an idle session) and reaches the
      // responsible agent as actionable context. Admission failures never
      // discard the stored comment: the response reports delivered=false.
      const exit = yield* Effect.exit(
        session.prompt({
          sessionID: artifact.sessionID,
          prompt: {
            text:
              `Human comment from ${input.author} on artifact "${artifact.name}" ` +
              `(${artifact.type}, version ${artifact.version}, status ${artifact.status}):\n\n` +
              `${input.body}\n\n` +
              "This comment is linked to this session as actionable context: review it and apply any change it requires.",
          },
          delivery: "steer",
        }),
      )
      return { comment: stored, delivered: Exit.isSuccess(exit) }
    })

    return Service.of({ create, get, list, update, comment })
  }),
)

export const node = makeGlobalNode({ service: Service, layer, deps: [Database.node] })
