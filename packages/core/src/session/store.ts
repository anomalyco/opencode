export * as SessionStore from "./store.js"

import { and, asc, desc, eq, gt, isNotNull, isNull, like, lt, notInArray, or, sql, type SQL } from "drizzle-orm"
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

// Walks up from every Session matching `starts` to its root: the topmost ancestor, also when its recorded parent no
// longer exists. `root(session_id, id)` pairs each starting Session with its root. UNION, not UNION ALL, so a corrupt
// parent cycle ends instead of recursing forever (and yields no root).
const rootCTE = (starts: SQL) => sql`
  ancestor(session_id, id, parent_id) AS (
    SELECT id, id, parent_id FROM ${SessionTable} WHERE ${starts}
    UNION
    SELECT ancestor.session_id, session.id, session.parent_id FROM ${SessionTable} AS session
    JOIN ancestor ON session.id = ancestor.parent_id
  ),
  root(session_id, id) AS (
    SELECT session_id, id FROM ancestor
    WHERE parent_id IS NULL OR NOT EXISTS (SELECT 1 FROM ${SessionTable} AS parent WHERE parent.id = ancestor.parent_id)
  )`

export interface Interface {
  readonly get: (sessionID: Session.ID) => Effect.Effect<Session.Persisted | undefined>
  readonly list: (input?: ListInput) => Effect.Effect<Session.Persisted[]>
  /**
   * The family containing `sessionID`: its root, then every descendant by `time_created` and `id`.
   * Empty when the Session does not exist.
   */
  readonly family: (sessionID: Session.ID) => Effect.Effect<Session.Persisted[]>
  /**
   * The root of the family containing each Session, by Session ID, with the same root rule as {@link Interface.family}.
   * Sessions that do not exist or sit on a parent cycle are absent.
   */
  readonly roots: (sessionIDs: ReadonlyArray<Session.ID>) => Effect.Effect<ReadonlyMap<Session.ID, Session.ID>>
  readonly messages: (input: MessagesInput) => Effect.Effect<SessionMessage.Info[], MessageDecodeError>
  readonly context: (sessionID: Session.ID) => Effect.Effect<SessionMessage.Info[], MessageDecodeError>
  readonly message: (
    messageID: SessionMessage.ID,
  ) => Effect.Effect<{ readonly sessionID: Session.ID; readonly message: SessionMessage.Info } | undefined>
  /** {@link Interface.messages} for clients that fetch media themselves: files stored in `blob` stay `media:` refs. */
  readonly messagesWithRefs: (input: MessagesInput) => Effect.Effect<SessionMessage.MediaInfo[], MessageDecodeError>
  /** {@link Interface.message} for clients that fetch media themselves. */
  readonly messageWithRefs: (
    messageID: SessionMessage.ID,
  ) => Effect.Effect<{ readonly sessionID: Session.ID; readonly message: SessionMessage.MediaInfo } | undefined>
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

    /** One page of a session's message rows, oldest first within the page when paging backwards. */
    const messageRows = Effect.fnUntraced(function* (input: MessagesInput) {
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
      const rows = yield* (input.limit === undefined ? query.all() : query.limit(input.limit).all()).pipe(Effect.orDie)
      return direction === "previous" ? rows.toReversed() : rows
    })

    const messageRow = (messageID: SessionMessage.ID) =>
      db.select().from(SessionMessageTable).where(eq(SessionMessageTable.id, messageID)).get().pipe(Effect.orDie)

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
      family: Effect.fn("SessionStore.family")(function* (sessionID) {
        const rows = yield* db
          .select()
          .from(SessionTable)
          .where(
            sql`${SessionTable.id} IN (
              WITH RECURSIVE
                ${rootCTE(sql`id = ${sessionID}`)},
                member(id) AS (
                  SELECT id FROM root
                  UNION
                  SELECT session.id FROM ${SessionTable} AS session JOIN member ON session.parent_id = member.id
                )
              SELECT id FROM member
            )`,
          )
          .orderBy(asc(SessionTable.time_created), asc(SessionTable.id))
          .all()
          .pipe(Effect.orDie)
        const ids = new Set(rows.map((row) => row.id))
        const root = rows.find((row) => row.parent_id === null || !ids.has(row.parent_id))
        return root ? [root, ...rows.filter((row) => row !== root)].map((row) => fromRow(row)) : []
      }),
      roots: Effect.fn("SessionStore.roots")(function* (sessionIDs) {
        if (sessionIDs.length === 0) return new Map()
        // One JSON parameter instead of one per ID: some SQLite hosts cap bound parameters per query.
        const starts = sql`${SessionTable.id} IN (SELECT value FROM json_each(${JSON.stringify(sessionIDs)}))`
        const rows = yield* db
          .all<{
            session_id: Session.ID
            id: Session.ID
          }>(sql`WITH RECURSIVE ${rootCTE(starts)} SELECT session_id, id FROM root`)
          .pipe(Effect.orDie)
        return new Map(rows.map((row) => [row.session_id, row.id]))
      }),
      messages: Effect.fn("SessionStore.messages")(function* (input) {
        return yield* SessionHistory.decodeMessageRows(db, yield* messageRows(input))
      }),
      messagesWithRefs: Effect.fn("SessionStore.messagesWithRefs")(function* (input) {
        return yield* SessionHistory.decodeMessageRowsWithRefs(db, yield* messageRows(input))
      }),
      context: Effect.fn("SessionStore.context")((sessionID) => SessionHistory.load(db, sessionID, "latest")),
      message: Effect.fn("SessionStore.message")(function* (messageID) {
        const row = yield* messageRow(messageID)
        if (!row) return undefined
        const [message] = yield* SessionHistory.decodeMessageRows(db, [row]).pipe(Effect.orDie)
        return message && { sessionID: row.session_id, message }
      }),
      messageWithRefs: Effect.fn("SessionStore.messageWithRefs")(function* (messageID) {
        const row = yield* messageRow(messageID)
        if (!row) return undefined
        const [message] = yield* SessionHistory.decodeMessageRowsWithRefs(db, [row]).pipe(Effect.orDie)
        return message && { sessionID: row.session_id, message }
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
