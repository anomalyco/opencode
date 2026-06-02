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
import { SessionProjector } from "./session/projector"
import { SessionMessageTable, SessionTable } from "./session/sql"
import { SessionSchema } from "./session/schema"
import { AbsolutePath, PositiveInt, RelativePath } from "./schema"
import { AgentV2 } from "./agent"

// get project -> project.locations
//
// get all sessions
//

// - by project
//   - by subpath
// - by workspace (home is special)

export const ListAnchor = Schema.Struct({
  id: SessionSchema.ID,
  time: Schema.Finite,
  direction: Schema.Literals(["previous", "next"]),
})
export type ListAnchor = typeof ListAnchor.Type

const ListInputBase = {
  workspaceID: WorkspaceV2.ID.pipe(Schema.optional),
  search: Schema.String.pipe(Schema.optional),
  limit: PositiveInt.pipe(Schema.optional),
  order: Schema.Literals(["asc", "desc"]).pipe(Schema.optional),
  anchor: ListAnchor.pipe(Schema.optional),
}

const ListDirectoryInput = Schema.Struct({
  ...ListInputBase,
  directory: AbsolutePath,
})

const ListProjectInput = Schema.Struct({
  ...ListInputBase,
  project: ProjectV2.ID,
  subpath: RelativePath.pipe(Schema.optional),
})

const ListAllInput = Schema.Struct(ListInputBase)

export const ListInput = Schema.Union([ListDirectoryInput, ListProjectInput, ListAllInput])
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

export class OperationUnavailableError extends Schema.TaggedErrorClass<OperationUnavailableError>()(
  "Session.OperationUnavailableError",
  {
    operation: Schema.Literals(["prompt", "compact", "wait"]),
  },
) {}

export class MessageDecodeError extends Schema.TaggedErrorClass<MessageDecodeError>()("Session.MessageDecodeError", {
  sessionID: SessionSchema.ID,
  messageID: SessionMessage.ID,
}) {}

export type Error = NotFoundError | MessageDecodeError | OperationUnavailableError

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
  }) => Effect.Effect<SessionMessage.Message[], NotFoundError | MessageDecodeError>
  readonly context: (
    sessionID: SessionSchema.ID,
  ) => Effect.Effect<SessionMessage.Message[], NotFoundError | MessageDecodeError>
  readonly switchAgent: (input: { sessionID: SessionSchema.ID; agent: string }) => Effect.Effect<void, never>
  readonly switchModel: (input: { sessionID: SessionSchema.ID; model: ModelV2.Ref }) => Effect.Effect<void, never>
  readonly prompt: (input: {
    id?: EventV2.ID
    sessionID: SessionSchema.ID
    prompt: Prompt
    delivery?: SessionSchema.Delivery
    resume?: boolean
  }) => Effect.Effect<SessionMessage.User, NotFoundError | OperationUnavailableError>
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
  readonly compact: (input: CompactInput) => Effect.Effect<void, NotFoundError | OperationUnavailableError>
  readonly wait: (id: SessionSchema.ID) => Effect.Effect<void, NotFoundError | OperationUnavailableError>
  readonly resume: (sessionID: SessionSchema.ID) => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/v2/Session") {}

function fromRow(row: typeof SessionTable.$inferSelect): SessionSchema.Info {
  return SessionSchema.Info.make({
    id: SessionSchema.ID.make(row.id),
    projectID: ProjectV2.ID.make(row.project_id),
    title: row.title,
    parentID: row.parent_id ? SessionSchema.ID.make(row.parent_id) : undefined,
    agent: row.agent ? AgentV2.ID.make(row.agent) : undefined,
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
    location: Location.Ref.make({
      directory: AbsolutePath.make(row.directory),
      workspaceID: row.workspace_id ? WorkspaceV2.ID.make(row.workspace_id) : undefined,
    }),
    subpath: row.path ? RelativePath.make(row.path) : undefined,
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
        const direction = input.anchor?.direction ?? "next"
        const requestedOrder = input.order ?? "desc"
        const order = direction === "previous" ? (requestedOrder === "asc" ? "desc" : "asc") : requestedOrder
        const sortColumn = SessionTable.time_created
        const conditions: SQL[] = []
        if ("directory" in input) conditions.push(eq(SessionTable.directory, input.directory))
        if (input.workspaceID) conditions.push(eq(SessionTable.workspace_id, input.workspaceID))
        if ("project" in input) conditions.push(eq(SessionTable.project_id, input.project))
        if (input.search) conditions.push(like(SessionTable.title, `%${input.search}%`))
        if (input.anchor) {
          conditions.push(
            order === "asc"
              ? or(
                  gt(sortColumn, input.anchor.time),
                  and(eq(sortColumn, input.anchor.time), gt(SessionTable.id, input.anchor.id)),
                )!
              : or(
                  lt(sortColumn, input.anchor.time),
                  and(eq(sortColumn, input.anchor.time), lt(SessionTable.id, input.anchor.id)),
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
      messages: Effect.fn("V2Session.messages")(function* (input) {
        yield* result.get(input.sessionID)
        const direction = input.cursor?.direction ?? "next"
        const requestedOrder = input.order ?? "desc"
        const order = direction === "previous" ? (requestedOrder === "asc" ? "desc" : "asc") : requestedOrder
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
        const query = db
          .select()
          .from(SessionMessageTable)
          .where(where)
          .orderBy(
            order === "asc" ? asc(SessionMessageTable.time_created) : desc(SessionMessageTable.time_created),
            order === "asc" ? asc(SessionMessageTable.id) : desc(SessionMessageTable.id),
          )
        const rows = yield* (input.limit === undefined ? query.all() : query.limit(input.limit).all()).pipe(
          Effect.orDie,
        )
        return yield* Effect.forEach(direction === "previous" ? rows.toReversed() : rows, decode)
      }),
      context: Effect.fn("V2Session.context")(function* (sessionID) {
        yield* result.get(sessionID)
        const compaction = yield* db
          .select()
          .from(SessionMessageTable)
          .where(and(eq(SessionMessageTable.session_id, sessionID), eq(SessionMessageTable.type, "compaction")))
          .orderBy(desc(SessionMessageTable.time_created), desc(SessionMessageTable.id))
          .limit(1)
          .get()
          .pipe(Effect.orDie)
        const rows = yield* db
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
          .pipe(Effect.orDie)
        return yield* Effect.forEach(rows, decode)
      }),
      prompt: Effect.fn("V2Session.prompt")(function* (input) {
        yield* result.get(input.sessionID)
        return yield* Effect.fail(new OperationUnavailableError({ operation: "prompt" }))
      }),
      shell: Effect.fn("V2Session.shell")(function* () {}),
      skill: Effect.fn("V2Session.skill")(function* () {}),
      switchAgent: Effect.fn("V2Session.switchAgent")(function* () {}),
      switchModel: Effect.fn("V2Session.switchModel")(function* () {}),
      compact: Effect.fn("V2Session.compact")(function* (input) {
        yield* result.get(input.sessionID)
        return yield* new OperationUnavailableError({ operation: "compact" })
      }),
      wait: Effect.fn("V2Session.wait")(function* (sessionID) {
        yield* result.get(sessionID)
        return yield* new OperationUnavailableError({ operation: "wait" })
      }),
      resume: Effect.fn("V2Session.resume")(function* () {}),
      move: Effect.fn("V2Session.move")(function* () {}),
    })

    return result
  }),
)

export const defaultLayer = layer.pipe(
  Layer.provide(SessionProjector.defaultLayer),
  Layer.provide(Database.defaultLayer),
  Layer.orDie,
)
