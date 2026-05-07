import { SessionMessageTable, SessionTable } from "@/session/session.sql"
import { SessionID } from "@/session/schema"
import { WorkspaceID } from "@/control-plane/schema"
import { and, asc, desc, eq, gt, gte, isNull, like, lt, or, type SQL } from "@/storage/db"
import * as Database from "@/storage/db"
import { Context, DateTime, Effect, Layer, Option, Schema } from "effect"
import { SessionMessage } from "./session-message"
import type { Prompt } from "./session-prompt"
import { EventV2 } from "./event"
import { ProjectID } from "@/project/schema"
import { SessionEvent } from "./session-event"
import { V2Schema } from "./schema"
import { optionalOmitUndefined } from "@/util/schema"
import { Modelv2 } from "./model"

export const Delivery = Schema.Literals(["immediate", "deferred"]).annotate({
  identifier: "Session.Delivery",
})
export type Delivery = Schema.Schema.Type<typeof Delivery>

export const DefaultDelivery = "immediate" satisfies Delivery

export class Info extends Schema.Class<Info>("Session.Info")({
  id: SessionID,
  parentID: optionalOmitUndefined(SessionID),
  projectID: ProjectID,
  workspaceID: optionalOmitUndefined(WorkspaceID),
  path: optionalOmitUndefined(Schema.String),
  agent: optionalOmitUndefined(Schema.String),
  model: Modelv2.Ref.pipe(optionalOmitUndefined),
  time: Schema.Struct({
    created: V2Schema.DateTimeUtcFromMillis,
    updated: V2Schema.DateTimeUtcFromMillis,
    archived: optionalOmitUndefined(V2Schema.DateTimeUtcFromMillis),
  }),
  title: Schema.String,
  /*
  slug: Schema.String,
  directory: Schema.String,
  path: optionalOmitUndefined(Schema.String),
  parentID: optionalOmitUndefined(SessionID),
  summary: optionalOmitUndefined(Summary),
  share: optionalOmitUndefined(Share),
  title: Schema.String,
  version: Schema.String,
  time: Time,
  permission: optionalOmitUndefined(Permission.Ruleset),
  revert: optionalOmitUndefined(Revert),
  */
}) {}

export class NotFoundError extends Schema.TaggedErrorClass<NotFoundError>()("Session.NotFoundError", {
  sessionID: SessionID,
}) {}

export interface Interface {
  readonly create: (input?: {
    agent?: string
    model?: Modelv2.Ref
    parentID?: SessionID
    workspaceID?: WorkspaceID
  }) => Effect.Effect<Info>
  readonly get: (sessionID: SessionID) => Effect.Effect<Info, NotFoundError>
  readonly list: (input: {
    limit?: number
    order?: "asc" | "desc"
    directory?: string
    path?: string
    workspaceID?: WorkspaceID
    roots?: boolean
    start?: number
    search?: string
    cursor?: {
      id: SessionID
      time: number
      direction: "previous" | "next"
    }
  }) => Effect.Effect<Info[], never>
  readonly messages: (input: {
    sessionID: SessionID
    limit?: number
    order?: "asc" | "desc"
    cursor?: {
      id: SessionMessage.ID
      time: number
      direction: "previous" | "next"
    }
  }) => Effect.Effect<SessionMessage.Message[], never>
  readonly context: (sessionID: SessionID) => Effect.Effect<SessionMessage.Message[], never>
  readonly prompt: (input: {
    id?: EventV2.ID
    sessionID: SessionID
    prompt: Prompt
    delivery?: Delivery
  }) => Effect.Effect<SessionMessage.User, never>
  readonly shell: (input: { id?: EventV2.ID; sessionID: SessionID; command: string }) => Effect.Effect<void, never>
  readonly skill: (input: { id?: EventV2.ID; sessionID: SessionID; skill: string }) => Effect.Effect<void, never>
  readonly subagent: (input: {
    id?: EventV2.ID
    parentID: SessionID
    prompt: Prompt
    agent: string
    model?: Modelv2.Ref
  }) => Effect.Effect<void, NotFoundError>
  readonly switchAgent: (input: { sessionID: SessionID; agent: string }) => Effect.Effect<void, never>
  readonly switchModel: (input: { sessionID: SessionID; model: Modelv2.Ref }) => Effect.Effect<void, never>
  readonly compact: (sessionID: SessionID) => Effect.Effect<void, never>
  readonly wait: (sessionID: SessionID) => Effect.Effect<void, never>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/v2/Session") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const decodeMessage = Schema.decodeUnknownSync(SessionMessage.Message)

    const decode = (row: typeof SessionMessageTable.$inferSelect) =>
      decodeMessage({ ...row.data, id: row.id, type: row.type })

    function fromRow(row: typeof SessionTable.$inferSelect): Info {
      return new Info({
        id: SessionID.make(row.id),
        projectID: ProjectID.make(row.project_id),
        workspaceID: row.workspace_id ? WorkspaceID.make(row.workspace_id) : undefined,
        title: row.title,
        parentID: row.parent_id ? SessionID.make(row.parent_id) : undefined,
        path: row.path ?? "",
        agent: row.agent ?? undefined,
        model: row.model
          ? {
              id: Modelv2.ID.make(row.model.id),
              providerID: Modelv2.ProviderID.make(row.model.providerID),
              variant: Modelv2.VariantID.make(row.model.variant ?? "default"),
            }
          : undefined,
        time: {
          created: DateTime.makeUnsafe(row.time_created),
          updated: DateTime.makeUnsafe(row.time_updated),
          archived: row.time_archived ? DateTime.makeUnsafe(row.time_archived) : undefined,
        },
      })
    }

    const result: Interface = {
      create: Effect.fn("V2Session.create")(function* (_input) {
        return {} as any
      }),
      get: Effect.fn("V2Session.get")(function* (sessionID) {
        const row = Database.use((db) => db.select().from(SessionTable).where(eq(SessionTable.id, sessionID)).get())
        if (!row) return yield* new NotFoundError({ sessionID })
        return fromRow(row)
      }),
      list: Effect.fn("V2Session.list")(function* (input) {
        const direction = input.cursor?.direction ?? "next"
        let order = input.order ?? "desc"
        // Query the adjacent rows in reverse, then flip them back into the requested order below.
        if (direction === "previous" && order === "asc") order = "desc"
        if (direction === "previous" && order === "desc") order = "asc"
        const conditions: SQL[] = []
        if (input.directory) conditions.push(eq(SessionTable.directory, input.directory))
        if (input.path)
          conditions.push(or(eq(SessionTable.path, input.path), like(SessionTable.path, `${input.path}/%`))!)
        if (input.workspaceID) conditions.push(eq(SessionTable.workspace_id, input.workspaceID))
        if (input.roots) conditions.push(isNull(SessionTable.parent_id))
        if (input.start) conditions.push(gte(SessionTable.time_created, input.start))
        if (input.search) conditions.push(like(SessionTable.title, `%${input.search}%`))
        if (input.cursor) {
          conditions.push(
            order === "asc"
              ? or(
                  gt(SessionTable.time_created, input.cursor.time),
                  and(eq(SessionTable.time_created, input.cursor.time), gt(SessionTable.id, input.cursor.id)),
                )!
              : or(
                  lt(SessionTable.time_created, input.cursor.time),
                  and(eq(SessionTable.time_created, input.cursor.time), lt(SessionTable.id, input.cursor.id)),
                )!,
          )
        }
        const query = Database.Client()
          .select()
          .from(SessionTable)
          .where(conditions.length > 0 ? and(...conditions) : undefined)
          .orderBy(
            order === "asc" ? asc(SessionTable.time_created) : desc(SessionTable.time_created),
            order === "asc" ? asc(SessionTable.id) : desc(SessionTable.id),
          )

        const rows = input.limit === undefined ? query.all() : query.limit(input.limit).all()
        return (direction === "previous" ? rows.toReversed() : rows).map((row) => fromRow(row))
      }),
      messages: Effect.fn("V2Session.messages")(function* (input) {
        const direction = input.cursor?.direction ?? "next"
        let order = input.order ?? "desc"
        // Query the adjacent rows in reverse, then flip them back into the requested order below.
        if (direction === "previous" && order === "asc") order = "desc"
        if (direction === "previous" && order === "desc") order = "asc"
        const boundary = input.cursor
          ? order === "asc"
            ? or(
                gt(SessionMessageTable.time_created, input.cursor.time),
                and(
                  eq(SessionMessageTable.time_created, input.cursor.time),
                  gt(SessionMessageTable.id, input.cursor.id),
                ),
              )
            : or(
                lt(SessionMessageTable.time_created, input.cursor.time),
                and(
                  eq(SessionMessageTable.time_created, input.cursor.time),
                  lt(SessionMessageTable.id, input.cursor.id),
                ),
              )
          : undefined
        const where = boundary
          ? and(eq(SessionMessageTable.session_id, input.sessionID), boundary)
          : eq(SessionMessageTable.session_id, input.sessionID)

        const rows = Database.use((db) => {
          const query = db
            .select()
            .from(SessionMessageTable)
            .where(where)
            .orderBy(
              order === "asc" ? asc(SessionMessageTable.time_created) : desc(SessionMessageTable.time_created),
              order === "asc" ? asc(SessionMessageTable.id) : desc(SessionMessageTable.id),
            )
          const rows = input.limit === undefined ? query.all() : query.limit(input.limit).all()
          return direction === "previous" ? rows.toReversed() : rows
        })
        return rows.map((row) => decode(row))
      }),
      context: Effect.fn("V2Session.context")(function* (sessionID) {
        const rows = Database.use((db) => {
          const compaction = db
            .select()
            .from(SessionMessageTable)
            .where(and(eq(SessionMessageTable.session_id, sessionID), eq(SessionMessageTable.type, "compaction")))
            .orderBy(desc(SessionMessageTable.time_created), desc(SessionMessageTable.id))
            .limit(1)
            .get()

          return db
            .select()
            .from(SessionMessageTable)
            .where(
              and(
                eq(SessionMessageTable.session_id, sessionID),
                compaction
                  ? or(
                      gt(SessionMessageTable.time_created, compaction.time_created),
                      and(
                        eq(SessionMessageTable.time_created, compaction.time_created),
                        gte(SessionMessageTable.id, compaction.id),
                      ),
                    )
                  : undefined,
              ),
            )
            .orderBy(asc(SessionMessageTable.time_created), asc(SessionMessageTable.id))
            .all()
        })
        return rows.map((row) => decode(row))
      }),
      prompt: Effect.fn("V2Session.prompt")(function* (_input) {
        return {} as any
      }),
      shell: Effect.fn("V2Session.shell")(function* (_input) {}),
      skill: Effect.fn("V2Session.skill")(function* (_input) {}),
      switchAgent: Effect.fn("V2Session.switchAgent")(function* (input) {
        EventV2.run(SessionEvent.AgentSwitched.Sync, {
          sessionID: input.sessionID,
          timestamp: DateTime.makeUnsafe(Date.now()),
          agent: input.agent,
        })
      }),
      switchModel: Effect.fn("V2Session.switchModel")(function* (input) {
        EventV2.run(SessionEvent.ModelSwitched.Sync, {
          sessionID: input.sessionID,
          timestamp: DateTime.makeUnsafe(Date.now()),
          model: input.model,
        })
      }),
      subagent: Effect.fn("V2Session.subagent")(function* (input) {
        const parent = yield* result.get(input.parentID)
        const session = yield* result.create({
          agent: input.agent,
          model: input.model,
          parentID: input.parentID,
          workspaceID: parent.workspaceID,
        })
        yield* result.prompt({
          prompt: input.prompt,
          sessionID: session.id,
        })
        yield* Effect.gen(function* () {
          yield* result.wait(session.id)
          const messages = yield* result.messages({ sessionID: session.id, order: "desc" })
          const assistant = messages.find((msg) => msg.type === "assistant")
          if (!assistant) return
          const text = assistant.content.findLast((part) => part.type === "text")
          if (!text) return
        }).pipe(Effect.forkChild())
      }),
      compact: Effect.fn("V2Session.compact")(function* (_sessionID) {}),
      wait: Effect.fn("V2Session.wait")(function* (_sessionID) {}),
    }

    return Service.of(result)
  }),
)

export const defaultLayer = layer

export * as SessionV2 from "./session"
