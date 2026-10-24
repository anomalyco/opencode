export * as SessionStore from "./store.js"

import {
  and,
  asc,
  count,
  desc,
  eq,
  getTableColumns,
  gt,
  inArray,
  isNotNull,
  isNull,
  like,
  lt,
  notInArray,
  or,
  sql,
  type SQL,
} from "drizzle-orm"
import { Context, Effect, Layer, Schema } from "effect"
import { Project } from "@opencode/schema/project"
import { Workspace } from "@opencode/schema/workspace"
import { AbsolutePath, PositiveInt, RelativePath } from "@opencode/schema/schema"
import { Database } from "../database/database.js"
import { makeGlobalNode } from "@opencode/util/effect/app-node"
import { SessionHistory } from "./history.js"
import { MessageDecodeError } from "./error.js"
import { SessionMessage } from "./message.js"
import { Session } from "@opencode/schema/session"
import { SessionMessageTable, SessionTable } from "./sql.js"
import { fromRow } from "./info.js"

const ListInputBase = {
  workspaceID: Workspace.ID.pipe(Schema.optional),
  search: Schema.String.pipe(Schema.optional),
  limit: PositiveInt.pipe(Schema.optional),
  order: Schema.Literals(["asc", "desc"]).pipe(Schema.optional),
  parentID: Schema.NullOr(Session.ID).pipe(Schema.optional),
  archived: Schema.Boolean.pipe(Schema.optional),
  anchor: Session.ListAnchor.pipe(Schema.optional),
}

const ListDirectoryInput = Schema.Struct({
  ...ListInputBase,
  directory: AbsolutePath,
})

const ListProjectInput = Schema.Struct({
  ...ListInputBase,
  project: Project.ID,
  subpath: RelativePath.pipe(Schema.optional),
})

const ListAllInput = Schema.Struct(ListInputBase)

export const ListInput = Schema.Union([ListDirectoryInput, ListProjectInput, ListAllInput])
export type ListInput = typeof ListInput.Type

export type MessagesInput = {
  sessionID: Session.ID
  limit?: number
  order?: "asc" | "desc"
  type?: SessionMessage.Type
  cursor?: {
    id: SessionMessage.ID
    direction: "previous" | "next"
  }
}

export type SearchInput = {
  /** Every whitespace-separated term must appear, case-insensitively, in the message text. */
  query: string
  limit: number
}

export type PageInput = {
  sessionID: Session.ID
  /** Index of the first message, counting from 0. Omit for the latest messages. */
  offset?: number
  limit: number
}

export interface Interface {
  readonly get: (sessionID: Session.ID) => Effect.Effect<Session.Info | undefined>
  readonly list: (input?: ListInput) => Effect.Effect<Session.Info[]>
  readonly messages: (input: MessagesInput) => Effect.Effect<SessionMessage.Info[], MessageDecodeError>
  /** Messages by their index in the session, counting from 0, plus the session's total message count. */
  readonly page: (input: PageInput) => Effect.Effect<
    {
      readonly total: number
      readonly messages: Array<{ readonly index: number; readonly message: SessionMessage.Info }>
    },
    MessageDecodeError
  >
  /** Message counts by session. Sessions without messages are left out. */
  readonly counts: (sessionIDs: ReadonlyArray<Session.ID>) => Effect.Effect<Map<Session.ID, number>>
  /** User and assistant messages whose text matches, newest first, across every session. */
  readonly search: (
    input: SearchInput,
  ) => Effect.Effect<
    Array<{ readonly sessionID: Session.ID; readonly index: number; readonly message: SessionMessage.Info }>,
    MessageDecodeError
  >
  readonly context: (sessionID: Session.ID) => Effect.Effect<SessionMessage.Info[], MessageDecodeError>
  readonly message: (
    messageID: SessionMessage.ID,
  ) => Effect.Effect<{ readonly sessionID: Session.ID; readonly message: SessionMessage.Info } | undefined>
  /**
   * Top-level Sessions holding an execution claim. Recoverable background
   * children are resumed separately through their durable Job records.
   */
  readonly listSuspended: () => Effect.Effect<ReadonlyArray<Session.ID>>
  /**
   * Records the execution claim: the durable write-ahead intent that a turn is
   * (or was) in flight. Set when execution starts; a claim that survives to the
   * next boot marks a turn that never completed — its process crashed or shut
   * down mid-turn.
   */
  readonly claim: (sessionID: Session.ID) => Effect.Effect<void>
  /** Releases the claim and resets resume accounting. Terminal events call this on commit. */
  readonly release: (sessionID: Session.ID) => Effect.Effect<void>
  /**
   * Clears orphaned child claims except children owned by recoverable
   * background subagent jobs.
   */
  readonly releaseChildClaims: (recoverable: ReadonlyArray<Session.ID>) => Effect.Effect<void>
  /**
   * Durably counts one more resume of an orphaned claim, returning the new
   * total — or undefined when the Session no longer exists.
   */
  readonly countResume: (sessionID: Session.ID) => Effect.Effect<number | undefined>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/SessionStore") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const { db } = yield* Database.Service

    return Service.of({
      get: Effect.fnUntraced(function* (sessionID) {
        const row = yield* db.select().from(SessionTable).where(eq(SessionTable.id, sessionID)).get().pipe(Effect.orDie)
        return row ? fromRow(row) : undefined
      }),
      list: Effect.fn("SessionStore.list")(function* (input = {}) {
        const direction = input.anchor?.direction ?? "next"
        const requestedOrder = input.order ?? "desc"
        const order = direction === "previous" ? (requestedOrder === "asc" ? "desc" : "asc") : requestedOrder
        const sortColumn = SessionTable.time_updated
        const conditions: SQL[] = []
        if ("directory" in input) conditions.push(eq(SessionTable.directory, input.directory))
        if (input.workspaceID) conditions.push(eq(SessionTable.workspace_id, input.workspaceID))
        if ("project" in input) conditions.push(eq(SessionTable.project_id, input.project))
        if ("project" in input && input.subpath !== undefined) conditions.push(eq(SessionTable.path, input.subpath))
        if (input.search) conditions.push(like(SessionTable.title, `%${input.search}%`))
        if (input.parentID !== undefined)
          conditions.push(
            input.parentID === null ? isNull(SessionTable.parent_id) : eq(SessionTable.parent_id, input.parentID),
          )
        if (input.archived !== undefined)
          conditions.push(input.archived ? isNotNull(SessionTable.time_archived) : isNull(SessionTable.time_archived))
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
      messages: Effect.fn("SessionStore.messages")(function* (input) {
        const direction = input.cursor?.direction ?? "next"
        const requestedOrder = input.order ?? "desc"
        const order = direction === "previous" ? (requestedOrder === "asc" ? "desc" : "asc") : requestedOrder
        const anchor = input.cursor
          ? yield* db
              .select({ seq: SessionMessageTable.seq })
              .from(SessionMessageTable)
              .where(
                and(eq(SessionMessageTable.session_id, input.sessionID), eq(SessionMessageTable.id, input.cursor.id)),
              )
              .get()
              .pipe(Effect.orDie)
          : undefined
        if (input.cursor && !anchor) return []
        const boundary = anchor
          ? order === "asc"
            ? gt(SessionMessageTable.seq, anchor.seq)
            : lt(SessionMessageTable.seq, anchor.seq)
          : undefined
        const query = db
          .select()
          .from(SessionMessageTable)
          .where(
            and(
              eq(SessionMessageTable.session_id, input.sessionID),
              boundary,
              input.type === undefined ? undefined : eq(SessionMessageTable.type, input.type),
            ),
          )
          .orderBy(order === "asc" ? asc(SessionMessageTable.seq) : desc(SessionMessageTable.seq))
        const rows = yield* (input.limit === undefined ? query.all() : query.limit(input.limit).all()).pipe(
          Effect.orDie,
        )
        return yield* Effect.forEach(
          direction === "previous" ? rows.toReversed() : rows,
          SessionHistory.decodeMessageRow,
        )
      }),
      page: Effect.fn("SessionStore.page")(function* (input) {
        const total =
          (yield* db
            .select({ total: count() })
            .from(SessionMessageTable)
            .where(eq(SessionMessageTable.session_id, input.sessionID))
            .get()
            .pipe(Effect.orDie))?.total ?? 0
        const offset = input.offset ?? Math.max(0, total - input.limit)
        const rows = yield* db
          .select()
          .from(SessionMessageTable)
          .where(eq(SessionMessageTable.session_id, input.sessionID))
          .orderBy(asc(SessionMessageTable.seq))
          .limit(input.limit)
          .offset(offset)
          .all()
          .pipe(Effect.orDie)
        const messages = yield* Effect.forEach(rows, (row, index) =>
          SessionHistory.decodeMessageRow(row).pipe(Effect.map((message) => ({ index: offset + index, message }))),
        )
        return { total, messages }
      }),
      counts: Effect.fn("SessionStore.counts")(function* (sessionIDs) {
        if (sessionIDs.length === 0) return new Map<Session.ID, number>()
        const rows = yield* db
          .select({ sessionID: SessionMessageTable.session_id, total: count() })
          .from(SessionMessageTable)
          .where(inArray(SessionMessageTable.session_id, [...sessionIDs]))
          .groupBy(SessionMessageTable.session_id)
          .all()
          .pipe(Effect.orDie)
        return new Map(rows.map((row) => [row.sessionID, row.total]))
      }),
      search: Effect.fn("SessionStore.search")(function* (input) {
        // A user message's text, or the text parts of an assistant message. Reasoning and tool parts are left out.
        const text = sql`coalesce(json_extract(${SessionMessageTable.data}, '$.text'), '') || char(10) || coalesce((select group_concat(json_extract(part.value, '$.text'), char(10)) from json_each(${SessionMessageTable.data}, '$.content') as part where json_extract(part.value, '$.type') = 'text'), '')`
        const rows = yield* db
          .select({
            ...getTableColumns(SessionMessageTable),
            // Count earlier messages for the 0-based index. Outer columns are qualified because Drizzle omits the table name.
            index: sql<number>`(select count(*) from ${SessionMessageTable} as earlier where earlier.session_id = "session_message"."session_id" and earlier.seq < "session_message"."seq")`,
          })
          .from(SessionMessageTable)
          .where(
            and(
              or(eq(SessionMessageTable.type, "user"), eq(SessionMessageTable.type, "assistant")),
              ...input.query
                .split(/\s+/)
                .filter(Boolean)
                .map((term) => sql`${text} like ${`%${term.replace(/[\\%_]/g, "\\$&")}%`} escape '\\'`),
            ),
          )
          .orderBy(desc(SessionMessageTable.time_created), desc(SessionMessageTable.id))
          .limit(input.limit)
          .all()
          .pipe(Effect.orDie)
        return yield* Effect.forEach(rows, (row) =>
          SessionHistory.decodeMessageRow(row).pipe(
            Effect.map((message) => ({ sessionID: row.session_id, index: row.index, message })),
          ),
        )
      }),
      context: Effect.fn("SessionStore.context")((sessionID) => SessionHistory.load(db, sessionID, "latest")),
      message: Effect.fn("SessionStore.message")(function* (messageID) {
        const row = yield* db
          .select()
          .from(SessionMessageTable)
          .where(eq(SessionMessageTable.id, messageID))
          .get()
          .pipe(Effect.orDie)
        return row
          ? {
              sessionID: row.session_id,
              message: yield* SessionHistory.decodeMessageRow(row).pipe(Effect.orDie),
            }
          : undefined
      }),
      listSuspended: Effect.fn("SessionStore.listSuspended")(function* () {
        return yield* db
          .select({ sessionID: SessionTable.id })
          .from(SessionTable)
          .where(and(isNotNull(SessionTable.time_suspended), isNull(SessionTable.parent_id)))
          .all()
          .pipe(
            Effect.orDie,
            Effect.map((rows) => rows.map((row) => row.sessionID)),
          )
      }),
      claim: Effect.fn("SessionStore.claim")(function* (sessionID) {
        // The null guard makes re-claiming a still-claimed Session a zero-row
        // no-op (a resumed turn re-claims through the same started hook).
        // Claim bookkeeping never counts as user activity: time_updated is
        // pinned so session ordering only moves on real changes.
        yield* db
          .update(SessionTable)
          .set({ time_suspended: Date.now(), time_updated: sql`${SessionTable.time_updated}` })
          .where(and(eq(SessionTable.id, sessionID), isNull(SessionTable.time_suspended)))
          .run()
          .pipe(Effect.orDie)
      }),
      release: Effect.fn("SessionStore.release")(function* (sessionID) {
        yield* db
          .update(SessionTable)
          .set({ time_suspended: null, resume_attempts: 0, time_updated: sql`${SessionTable.time_updated}` })
          .where(eq(SessionTable.id, sessionID))
          .run()
          .pipe(Effect.orDie)
      }),
      releaseChildClaims: Effect.fn("SessionStore.releaseChildClaims")((recoverable) =>
        db
          .update(SessionTable)
          .set({ time_suspended: null, resume_attempts: 0, time_updated: sql`${SessionTable.time_updated}` })
          .where(
            and(
              isNotNull(SessionTable.time_suspended),
              isNotNull(SessionTable.parent_id),
              recoverable.length > 0 ? notInArray(SessionTable.id, Array.from(recoverable)) : undefined,
            ),
          )
          .run()
          .pipe(Effect.orDie, Effect.asVoid),
      ),
      countResume: Effect.fn("SessionStore.countResume")(function* (sessionID) {
        const row = yield* db
          .update(SessionTable)
          .set({
            resume_attempts: sql`${SessionTable.resume_attempts} + 1`,
            time_updated: sql`${SessionTable.time_updated}`,
          })
          .where(eq(SessionTable.id, sessionID))
          .returning({ attempts: SessionTable.resume_attempts })
          .get()
          .pipe(Effect.orDie)
        return row?.attempts
      }),
    })
  }),
)

export const node = makeGlobalNode({ service: Service, layer, deps: [Database.node] })
