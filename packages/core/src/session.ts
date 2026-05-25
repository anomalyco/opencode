export * as SessionV2 from "./session"
export * from "./session/schema"

import { DateTime, Effect, Layer, Schema, Context } from "effect"
import { and, asc, desc, eq, gt, gte, like, lt, or, type SQL } from "drizzle-orm"
import { ProjectV2 } from "./project"
import { WorkspaceV2 } from "./workspace"
import { ModelV2 } from "./model"
import { Location } from "./location"
import { SessionMessage } from "./session/message"
import type { Prompt } from "./session/prompt"
import { EventV2 } from "./event"
import { ProviderV2 } from "./provider"
import { Database } from "./database/database"
import { SessionMessageTable, SessionTable } from "./session/sql"
import { SessionSchema } from "./session/schema"
import { AbsolutePath, RelativePath } from "./schema"

// get project -> project.locations
//
// get all sessions
//

// - by project
//   - by subpath
// - by workspace (home is special)

export const ListCursor = Schema.Struct({
  id: SessionSchema.ID,
  time: Schema.Finite,
  direction: Schema.Literals(["previous", "next"]),
})
export type ListCursor = typeof ListCursor.Type

const ListInputBase = {
  workspaceID: WorkspaceV2.ID.pipe(Schema.optional),
  search: Schema.String.pipe(Schema.optional),
  limit: Schema.Int.pipe(Schema.optional),
  order: Schema.Literal("asc").pipe(Schema.optional),
  cursor: ListCursor.pipe(Schema.optional),
}

export const ListInput = Schema.Union([
  Schema.Struct({
    ...ListInputBase,
  }),
  Schema.Struct({
    ...ListInputBase,
    directory: AbsolutePath,
  }),
  Schema.Struct({
    ...ListInputBase,
    project: ProjectV2.ID,
    subpath: RelativePath.pipe(Schema.optional),
  }),
])
export type ListInput = typeof ListInput.Type

type CreateInput = {
  id?: SessionSchema.ID
  agent?: string
  model?: ModelV2.Ref
  location: Location.Ref
}

type MoveInput = {
  sessionID: SessionSchema.ID
  location: Location.Ref
}

type CompactInput = {
  sessionID: SessionSchema.ID
  prompt?: Prompt
}

export class NotFoundError extends Schema.TaggedErrorClass<NotFoundError>()("Session.NotFoundError", {
  sessionID: SessionSchema.ID,
}) {}

export class MessageDecodeError extends Schema.TaggedErrorClass<MessageDecodeError>()("Session.MessageDecodeError", {
  sessionID: SessionSchema.ID,
  messageID: SessionMessage.ID,
}) {}

export type Error = NotFoundError | MessageDecodeError

export interface Interface {
  readonly list: (input?: ListInput) => Effect.Effect<SessionSchema.Info[]>
  readonly create: (input?: CreateInput) => Effect.Effect<SessionSchema.Info>
  readonly move: (input: MoveInput) => Effect.Effect<void, NotFoundError>
  readonly get: (sessionID: SessionSchema.ID) => Effect.Effect<SessionSchema.Info, NotFoundError>
  readonly messages: (input: {
    sessionID: SessionSchema.ID
    limit?: number
    order?: "asc" | "desc"
    cursor?: {
      id: SessionMessage.ID
      time: number
      direction: "previous" | "next"
    }
  }) => Effect.Effect<SessionMessage.Message[], NotFoundError>
  readonly context: (sessionID: SessionSchema.ID) => Effect.Effect<SessionMessage.Message[], NotFoundError>
  readonly switchAgent: (input: { sessionID: SessionSchema.ID; agent: string }) => Effect.Effect<void, never>
  readonly switchModel: (input: { sessionID: SessionSchema.ID; model: ModelV2.Ref }) => Effect.Effect<void, never>
  readonly prompt: (input: {
    id?: EventV2.ID
    sessionID: SessionSchema.ID
    prompt: Prompt
    delivery?: SessionSchema.Delivery
    resume?: boolean
  }) => Effect.Effect<void, NotFoundError>
  readonly shell: (input: {
    id?: EventV2.ID
    sessionID: SessionSchema.ID
    command: string
    delivery?: SessionSchema.Delivery
    resume?: boolean
  }) => Effect.Effect<void, never>
  readonly skill: (input: {
    id?: EventV2.ID
    sessionID: SessionSchema.ID
    skill: string
    delivery?: SessionSchema.Delivery
    resume?: boolean
  }) => Effect.Effect<void, never>
  readonly compact: (input: CompactInput) => Effect.Effect<void, NotFoundError>
  readonly wait: (id: SessionSchema.ID) => Effect.Effect<void, NotFoundError>
  readonly resume: (sessionID: SessionSchema.ID) => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/v2/Session") {}

function fromRow(row: typeof SessionTable.$inferSelect): SessionSchema.Info {
  return new SessionSchema.Info({
    id: SessionSchema.ID.make(row.id),
    projectID: ProjectV2.ID.make(row.project_id),
    workspaceID: row.workspace_id ? WorkspaceV2.ID.make(row.workspace_id) : undefined,
    title: row.title,
    parentID: row.parent_id ? SessionSchema.ID.make(row.parent_id) : undefined,
    path: row.path ?? "",
    agent: row.agent ?? undefined,
    model: row.model
      ? {
          id: ModelV2.ID.make(row.model.id),
          providerID: ProviderV2.ID.make(row.model.providerID),
          variant: ModelV2.VariantID.make(row.model.variant ?? "default"),
        }
      : undefined,
    cost: row.cost,
    tokens: {
      input: row.tokens_input,
      output: row.tokens_output,
      reasoning: row.tokens_reasoning,
      cache: {
        read: row.tokens_cache_read,
        write: row.tokens_cache_write,
      },
    },
    time: {
      created: DateTime.makeUnsafe(row.time_created),
      updated: DateTime.makeUnsafe(row.time_updated),
      archived: row.time_archived ? DateTime.makeUnsafe(row.time_archived) : undefined,
    },
  })
}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const db = (yield* Database.Service).db
    const decodeMessage = Schema.decodeUnknownEffect(SessionMessage.Message)

    const decode = (row: typeof SessionMessageTable.$inferSelect) =>
      decodeMessage({ ...row.data, id: row.id, type: row.type }).pipe(
        Effect.mapError(
          () =>
            new MessageDecodeError({
              sessionID: SessionSchema.ID.make(row.session_id),
              messageID: SessionMessage.ID.make(row.id),
            }),
        ),
      )

    const result = Service.of({
      create: Effect.fn("V2Session.create")(function* () {
        return {} as SessionSchema.Info
      }),
      get: Effect.fn("V2Session.get")(function* (sessionID) {
        const row = yield* db.select().from(SessionTable).where(eq(SessionTable.id, sessionID)).get().pipe(Effect.orDie)
        if (!row) return yield* new NotFoundError({ sessionID })
        return fromRow(row)
      }),
      list: Effect.fn("V2Session.list")(function* (input = {}) {
        const direction = input.cursor?.direction ?? "next"
        const requestedOrder = input.order ?? "desc"
        const order = direction === "previous" ? (requestedOrder === "asc" ? "desc" : "asc") : requestedOrder
        const sortColumn = SessionTable.time_updated
        const conditions: SQL[] = []
        if ("directory" in input) conditions.push(eq(SessionTable.directory, input.directory))
        if (input.workspaceID) conditions.push(eq(SessionTable.workspace_id, input.workspaceID))
        if ("project" in input) conditions.push(eq(SessionTable.project_id, input.project))
        if (input.search) conditions.push(like(SessionTable.title, `%${input.search}%`))
        if (input.cursor) {
          conditions.push(
            order === "asc"
              ? or(
                  gt(sortColumn, input.cursor.time),
                  and(eq(sortColumn, input.cursor.time), gt(SessionTable.id, input.cursor.id)),
                )!
              : or(
                  lt(sortColumn, input.cursor.time),
                  and(eq(sortColumn, input.cursor.time), lt(SessionTable.id, input.cursor.id)),
                )!,
          )
        }
        const query = db
          .select()
          .from(SessionTable)
          .where(conditions.length > 0 ? and(...conditions) : undefined)
          .orderBy(
            order === "asc" ? asc(sortColumn) : desc(sortColumn),
            order === "asc" ? asc(SessionTable.id) : desc(SessionTable.id),
          )
        const rows = yield* (input.limit === undefined ? query.all() : query.limit(input.limit).all()).pipe(
          Effect.orDie,
        )
        return (direction === "previous" ? rows.toReversed() : rows).map((row) => fromRow(row))
      }),
      messages: Effect.fn("V2Session.messages")(function* () {
        return yield* Effect.die(new Error("Session.messages is not implemented"))
      }),
      context: Effect.fn("V2Session.context")(function* () {
        return yield* Effect.die(new Error("Session.context is not implemented"))
      }),
      prompt: Effect.fn("V2Session.prompt")(function* () {
        return yield* Effect.die(new Error("Session.prompt is not implemented"))
      }),
      shell: Effect.fn("V2Session.shell")(function* () {}),
      skill: Effect.fn("V2Session.skill")(function* () {}),
      switchAgent: Effect.fn("V2Session.switchAgent")(function* () {}),
      switchModel: Effect.fn("V2Session.switchModel")(function* () {}),
      compact: Effect.fn("V2Session.compact")(function* () {
        return yield* Effect.die(new Error("Session.compact is not implemented"))
      }),
      wait: Effect.fn("V2Session.wait")(function* () {
        return yield* Effect.die(new Error("Session.wait is not implemented"))
      }),
      resume: Effect.fn("V2Session.resume")(function* () {}),
      move: Effect.fn("V2Session.move")(function* () {}),
    })

    return result
  }),
)

export const defaultLayer = layer.pipe(Layer.provide(Database.defaultLayer), Layer.orDie)
