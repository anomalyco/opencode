export * as SessionSearch from "./search.js"

import { and, asc, desc, eq, gt, inArray, isNull, lt, sql, type SQL } from "drizzle-orm"
import { Context, DateTime, Effect, Layer, Schema } from "effect"
import { makeGlobalNode } from "@opencode/util/effect/app-node"
import { optional } from "@opencode/schema/schema"
import { Project } from "@opencode/schema/project"
import { Session } from "@opencode/schema/session"
import type { Tool } from "@opencode/schema/tool"
import { kind } from "#dialect"
import { Database } from "../database/database.js"
import { SessionHistory } from "./history.js"
import { SessionMessage } from "./message.js"
import { SessionSearchIndex } from "./search-index.js"
import { SessionMessageTable, SessionTable } from "./sql.js"

type DatabaseService = Database.Interface["db"]

/** Characters of context on each side of a snippet's match. */
const SNIPPET_CONTEXT = 120
/** Characters of a tool's input shown in its one-line summary. Full text goes through the tool output limit. */
const TOOL_SUMMARY_INPUT = 120
const MAX_MATCHES_PER_SESSION = 3

const VISIBLE_TYPES = ["user", "assistant", "compaction", "shell", "synthetic", "skill"] as const
const VISIBLE_WITH_SYSTEM = [...VISIBLE_TYPES, "system"] as const

export class IndexUnavailableError extends Schema.TaggedError<IndexUnavailableError>()(
  "SessionSearch.IndexUnavailableError",
  {
    reason: Schema.String,
  },
) {
  override get message() {
    return this.reason
  }
}

export class SessionNotFoundError extends Schema.TaggedError<SessionNotFoundError>()(
  "SessionSearch.SessionNotFoundError",
  {
    sessionID: Session.ID,
  },
) {
  override get message() {
    return `Session not found: ${this.sessionID}`
  }
}

export class MessageNotFoundError extends Schema.TaggedError<MessageNotFoundError>()(
  "SessionSearch.MessageNotFoundError",
  {
    sessionID: Session.ID,
    messageID: SessionMessage.ID,
  },
) {
  override get message() {
    return `Message ${this.messageID} not found in session ${this.sessionID}`
  }
}

export type Error = IndexUnavailableError | SessionNotFoundError | MessageNotFoundError

export const SessionSummary = Schema.Struct({
  sessionID: Session.ID,
  title: Schema.String,
  directory: Schema.String,
  created: Schema.String,
  updated: Schema.String,
  parentID: Session.ID.pipe(optional),
})
export type SessionSummary = typeof SessionSummary.Type

export const Match = Schema.Struct({
  messageID: SessionMessage.ID.pipe(optional),
  type: Schema.String,
  time: Schema.String,
  snippet: Schema.String,
})
export type Match = typeof Match.Type

export const SearchResult = Schema.Struct({
  sessionID: Session.ID,
  title: Schema.String,
  directory: Schema.String,
  created: Schema.String,
  updated: Schema.String,
  parentID: Session.ID.pipe(optional),
  matches: Schema.Array(Match),
})
export type SearchResult = typeof SearchResult.Type

export const SearchOutput = Schema.Struct({
  next: Schema.NullOr(Schema.Number).pipe(optional),
  results: Schema.Array(SearchResult).pipe(optional),
  sessions: Schema.Array(SessionSummary).pipe(optional),
})
export type SearchOutput = typeof SearchOutput.Type

export const CallDetail = Schema.Struct({
  name: Schema.String,
  status: Schema.String,
  error: Schema.String.pipe(optional),
  input: Schema.String.pipe(optional),
  output: Schema.String.pipe(optional),
})
export type CallDetail = typeof CallDetail.Type

export const ReadMessage = Schema.Struct({
  messageID: SessionMessage.ID,
  type: Schema.String,
  time: Schema.String,
  text: Schema.String.pipe(optional),
  calls: Schema.Array(Schema.Union([Schema.String, CallDetail])).pipe(optional),
})
export type ReadMessage = typeof ReadMessage.Type

// The cursors come before messages, so they survive when a long page is cut at the tool output limit.
export const ReadOutput = Schema.Struct({
  session: SessionSummary,
  older: SessionMessage.ID.pipe(optional),
  newer: SessionMessage.ID.pipe(optional),
  messages: Schema.Array(ReadMessage),
})
export type ReadOutput = typeof ReadOutput.Type

export interface SearchInput {
  readonly query?: string
  /** Only sessions in this project. Ignored when `sessionID` is set. */
  readonly projectID?: Project.ID
  readonly sessionID?: Session.ID
  readonly directory?: string
  readonly subagents?: boolean
  readonly limit?: number
  readonly offset?: number
}

export interface ReadInput {
  readonly sessionID: Session.ID
  readonly messageID?: SessionMessage.ID
  readonly direction?: "around" | "before" | "after"
  readonly limit?: number
  readonly full?: boolean
}

export interface Interface {
  readonly search: (input?: SearchInput) => Effect.Effect<SearchOutput, IndexUnavailableError>
  readonly read: (input: ReadInput) => Effect.Effect<ReadOutput, SessionNotFoundError | MessageNotFoundError>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/SessionSearch") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const db = (yield* Database.Service).db

    const search = Effect.fn("SessionSearch.search")(function* (input: SearchInput = {}) {
      const query = input.query?.trim()
      if (!query) return yield* listSessions(db, input)
      return yield* searchSessions(db, { ...input, query })
    })

    const read = Effect.fn("SessionSearch.read")(function* (input: ReadInput) {
      return yield* readSession(db, input)
    })

    return Service.of({ search, read })
  }),
)

export const node = makeGlobalNode({
  service: Service,
  layer,
  deps: [Database.node],
})

const listSessions = Effect.fnUntraced(function* (
  db: DatabaseService,
  input: SearchInput,
): Effect.fn.Return<SearchOutput> {
  const limit = clamp(input.limit ?? 20, 1, 100)
  const offset = Math.max(0, input.offset ?? 0)
  const conditions = sessionConditions({
    sessionID: input.sessionID,
    projectID: input.sessionID ? undefined : input.projectID,
    directory: input.directory,
    subagents: input.sessionID ? true : (input.subagents ?? false),
  })
  const rows = yield* db
    .select()
    .from(SessionTable)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(SessionTable.time_updated), desc(SessionTable.id))
    .limit(limit + 1)
    .offset(offset)
    .all()
    .pipe(Effect.orDie)
  return {
    sessions: rows.slice(0, limit).map(toSummary),
    next: rows.length > limit ? offset + limit : null,
  }
})

const searchSessions = Effect.fnUntraced(function* (
  db: DatabaseService,
  input: SearchInput & { readonly query: string },
): Effect.fn.Return<SearchOutput, IndexUnavailableError> {
  const folded = SessionSearchIndex.foldText(input.query)
  const fallback = plainOrQuery(folded)
  if (!fallback) return { results: [] }

  const limit = clamp(input.limit ?? 5, 1, 20)
  const hitLimit = Math.min(400, Math.max(100, limit * 20))
  const filters = sessionConditions({
    sessionID: input.sessionID,
    projectID: input.sessionID ? undefined : input.projectID,
    directory: input.directory,
    subagents: input.sessionID ? true : (input.subagents ?? true),
  })
  const runMatch = (expression: string) =>
    kind === "postgres"
      ? db.all<{ source_id: string; session_id: string; score: number }>(sql`
          SELECT d.source_id AS source_id, d.session_id AS session_id,
            ts_rank(d.document, websearch_to_tsquery('simple', ${SessionSearchIndex.queryExpression(expression)})) AS score
          FROM session_search AS d
          JOIN session_v2 ON session_v2.id = d.session_id
          WHERE d.document @@ websearch_to_tsquery('simple', ${SessionSearchIndex.queryExpression(expression)})${filters.length > 0 ? sql` AND ${and(...filters)}` : sql``}
          ORDER BY score DESC
          LIMIT ${hitLimit}
        `)
      : db.all<{ source_id: string; session_id: string; score: number }>(sql`
          SELECT d.source_id AS source_id, d.session_id AS session_id,
            bm25(session_search, 3.0, 2.0, 1.5, 1.0) AS score
          FROM session_search
          JOIN session_search_document AS d ON d.id = session_search.rowid
          JOIN session_v2 ON session_v2.id = d.session_id
          WHERE session_search MATCH ${expression}${filters.length > 0 ? sql` AND ${and(...filters)}` : sql``}
          ORDER BY score
          LIMIT ${hitLimit}
        `)

  const raw = hasFtsSyntax(folded) ? folded : fallback
  const hits = yield* runMatch(raw).pipe(
    Effect.catch((error) => {
      if (!SessionSearchIndex.isQueryError(error)) return Effect.die(error)
      if (raw !== fallback) {
        return runMatch(fallback).pipe(
          Effect.catch((retryError) => {
            if (!SessionSearchIndex.isQueryError(retryError)) return Effect.die(retryError)
            return Effect.fail(new IndexUnavailableError({ reason: "Session search index is unavailable." }))
          }),
        )
      }
      return Effect.fail(new IndexUnavailableError({ reason: "Session search index is unavailable." }))
    }),
  )

  const grouped = new Map<Session.ID, string[]>()
  for (const hit of hits) {
    const sessionID = Session.ID.make(hit.session_id)
    const list = grouped.get(sessionID)
    if (list) {
      if (list.length < MAX_MATCHES_PER_SESSION && !list.includes(hit.source_id)) list.push(hit.source_id)
      continue
    }
    if (grouped.size >= limit) continue
    grouped.set(sessionID, [hit.source_id])
  }
  if (grouped.size === 0) return { results: [] }

  const sessionIDs = Array.from(grouped.keys())
  const sessionMap = new Map(
    (yield* db.select().from(SessionTable).where(inArray(SessionTable.id, sessionIDs)).all().pipe(Effect.orDie)).map(
      (row) => [row.id, row] as const,
    ),
  )

  const messageIDs = Array.from(grouped.entries()).flatMap(([sessionID, sources]) =>
    sources.flatMap((source) => (source === sessionID ? [] : [SessionMessage.ID.make(source)])),
  )
  const messageRows = yield* db
    .select()
    .from(SessionMessageTable)
    .where(inArray(SessionMessageTable.id, messageIDs))
    .all()
    .pipe(Effect.orDie)
  const messageMap = new Map((yield* decodeWindowRows(db, messageRows)).map((decoded) => [decoded.row.id, decoded] as const))

  const results: SearchResult[] = []
  for (const [sessionID, sources] of grouped) {
    const session = sessionMap.get(sessionID)
    if (!session) continue
    const matches: Match[] = []
    for (const source of sources) {
      if (source === sessionID) {
        if (!session.title) continue
        matches.push({
          type: "title",
          time: formatTime(session.time_created),
          snippet: makeSnippet(session.title, input.query),
        })
        continue
      }
      const decoded = messageMap.get(SessionMessage.ID.make(source))
      if (!decoded) continue
      const text = extractIndexedText(decoded.message)
      if (!text) continue
      matches.push({
        messageID: decoded.row.id,
        type: decoded.row.type,
        time: formatTime(decoded.row.time_created),
        snippet: makeSnippet(text, input.query),
      })
    }
    if (matches.length === 0) continue
    const summary = toSummary(session)
    results.push({ ...summary, matches })
  }

  return { results }
})

/**
 * Reads up to `limit` messages around, before or after `messageID`, or from the newest (around, before) or oldest
 * (after) message without one. Before and after exclude the anchor, and the cursors are the oldest and newest message
 * returned, so passing one back with the same direction never repeats a message.
 */
const readSession = Effect.fnUntraced(function* (
  db: DatabaseService,
  input: ReadInput,
): Effect.fn.Return<ReadOutput, SessionNotFoundError | MessageNotFoundError> {
  const session = yield* db
    .select()
    .from(SessionTable)
    .where(eq(SessionTable.id, input.sessionID))
    .get()
    .pipe(Effect.orDie)
  if (!session) return yield* new SessionNotFoundError({ sessionID: input.sessionID })

  const full = input.full === true
  const visible = full ? VISIBLE_WITH_SYSTEM : VISIBLE_TYPES
  const filter = and(eq(SessionMessageTable.session_id, input.sessionID), inArray(SessionMessageTable.type, visible))
  const limit = clamp(input.limit ?? 7, 1, 50)
  const direction = input.direction ?? "around"
  const older = (seq: number | undefined, count: number) =>
    db
      .select()
      .from(SessionMessageTable)
      .where(seq === undefined ? filter : and(filter, lt(SessionMessageTable.seq, seq)))
      .orderBy(desc(SessionMessageTable.seq))
      .limit(count + 1)
      .all()
      .pipe(Effect.orDie)
  const newer = (seq: number | undefined, count: number) =>
    db
      .select()
      .from(SessionMessageTable)
      .where(seq === undefined ? filter : and(filter, gt(SessionMessageTable.seq, seq)))
      .orderBy(asc(SessionMessageTable.seq))
      .limit(count + 1)
      .all()
      .pipe(Effect.orDie)

  const anchor = input.messageID
    ? yield* db
        .select()
        .from(SessionMessageTable)
        .where(and(eq(SessionMessageTable.session_id, input.sessionID), eq(SessionMessageTable.id, input.messageID)))
        .get()
        .pipe(Effect.orDie)
    : undefined
  if (input.messageID && !anchor)
    return yield* new MessageNotFoundError({ sessionID: input.sessionID, messageID: input.messageID })

  if (anchor && direction === "around") {
    const beforeCount = Math.floor((limit - 1) / 2)
    const afterCount = limit - 1 - beforeCount
    const before = yield* older(anchor.seq, beforeCount)
    const after = yield* newer(anchor.seq, afterCount)
    const rows = [...before.slice(0, beforeCount).toReversed(), anchor, ...after.slice(0, afterCount)]
    return formatReadOutput(
      session,
      yield* decodeWindowRows(db, rows),
      full,
      before.length > beforeCount ? rows[0]?.id : undefined,
      after.length > afterCount ? rows.at(-1)?.id : undefined,
    )
  }

  if (direction === "after") {
    const rows = yield* newer(anchor?.seq, limit)
    const page = rows.slice(0, limit)
    return formatReadOutput(
      session,
      yield* decodeWindowRows(db, page),
      full,
      anchor ? (page[0]?.id ?? anchor.id) : undefined,
      rows.length > limit ? page.at(-1)?.id : undefined,
    )
  }

  const rows = yield* older(anchor?.seq, limit)
  const page = rows.slice(0, limit).toReversed()
  return formatReadOutput(
    session,
    yield* decodeWindowRows(db, page),
    full,
    rows.length > limit ? page[0]?.id : undefined,
    anchor ? (page.at(-1)?.id ?? anchor.id) : undefined,
  )
})

type DecodedRow = {
  readonly row: typeof SessionMessageTable.$inferSelect
  readonly message: SessionMessage.MediaInfo
}

/** Decodes rows without hydrating media blobs. A row that no longer decodes is skipped instead of failing the page. */
const decodeWindowRows = (db: DatabaseService, rows: ReadonlyArray<typeof SessionMessageTable.$inferSelect>) =>
  Effect.forEach(rows, (row) =>
    SessionHistory.decodeMessageRowsWithRefs(db, [row]).pipe(
      Effect.map(([message]) => (message ? [{ row, message }] : [])),
      Effect.orElseSucceed(() => []),
    ),
  ).pipe(Effect.map((decoded): DecodedRow[] => decoded.flat()))

function formatReadOutput(
  session: typeof SessionTable.$inferSelect,
  rows: ReadonlyArray<DecodedRow>,
  full: boolean,
  older: SessionMessage.ID | undefined,
  newer: SessionMessage.ID | undefined,
): ReadOutput {
  return {
    session: toSummary(session),
    ...(older === undefined ? {} : { older }),
    ...(newer === undefined ? {} : { newer }),
    messages: rows.map((entry) => formatMessage(entry.row, entry.message, full)),
  }
}

function formatMessage(
  row: typeof SessionMessageTable.$inferSelect,
  message: SessionMessage.MediaInfo,
  full: boolean,
): ReadMessage {
  const base: {
    messageID: SessionMessage.ID
    type: string
    time: string
    text?: string
    calls?: Array<string | CallDetail>
  } = {
    messageID: row.id,
    type: row.type,
    time: formatTime(row.time_created),
  }

  if (message.type === "user" || message.type === "synthetic" || message.type === "system" || message.type === "skill") {
    const text = nonEmpty(message.text)
    if (text !== undefined) base.text = text
    return base
  }
  if (message.type === "compaction") {
    const raw =
      message.status === "completed"
        ? message.summary
        : message.status === "failed"
          ? message.error.message
          : "(compaction running)"
    const text = nonEmpty(raw)
    if (text !== undefined) base.text = text
    return base
  }
  if (message.type === "shell") {
    const raw =
      full && message.output?.output ? `$ ${message.command}\n${message.output.output}` : `$ ${message.command}`
    const text = nonEmpty(raw)
    if (text !== undefined) base.text = text
    return base
  }
  if (message.type === "assistant") {
    const joined = message.content
      .flatMap((part) => (part.type === "text" && part.text.trim() ? [part.text] : []))
      .join("\n\n")
    const text = nonEmpty(joined)
    if (text !== undefined) base.text = text
    const calls = message.content.flatMap((part) =>
      part.type === "tool" ? [formatCall(part, full)] : [],
    )
    if (calls.length > 0) base.calls = calls
    return base
  }
  return base
}

function formatCall(part: SessionMessage.AssistantTool, full: boolean): string | CallDetail {
  const inputText = part.state.status === "streaming" ? part.state.input : JSON.stringify(part.state.input)
  if (!full) {
    const args = cap(inputText, TOOL_SUMMARY_INPUT) ?? ""
    const suffix = part.state.status === "error" ? " → error" : ""
    return `${part.name}(${args})${suffix}`
  }
  const detail: {
    name: string
    status: string
    input?: string
    output?: string
    error?: string
  } = { name: part.name, status: part.state.status }
  const input = nonEmpty(inputText)
  if (input !== undefined) detail.input = input
  if (part.state.status === "completed") {
    const output = nonEmpty(toolContentText(part.state.content))
    if (output !== undefined) detail.output = output
  }
  if (part.state.status === "error") {
    const error = nonEmpty(part.state.error.message)
    if (error !== undefined) detail.error = error
    if (part.state.content) {
      const output = nonEmpty(toolContentText(part.state.content))
      if (output !== undefined) detail.output = output
    }
  }
  return detail
}

function toolContentText(content: ReadonlyArray<Tool.Content>) {
  return content
    .map((item) => (item.type === "text" ? item.text : `[file: ${item.name ?? item.mime}]`))
    .join("\n")
}

function extractIndexedText(message: SessionMessage.MediaInfo) {
  if (message.type === "user") return message.text.slice(0, SessionSearchIndex.MaxText)
  if (message.type === "compaction" && message.status === "completed")
    return message.summary.slice(0, SessionSearchIndex.MaxText)
  if (message.type === "assistant")
    return message.content
      .flatMap((part) => (part.type === "text" && part.text.trim() ? [part.text.slice(0, SessionSearchIndex.MaxText)] : []))
      .join("\n\n")
      .slice(0, SessionSearchIndex.MaxText)
  return ""
}

function toSummary(row: typeof SessionTable.$inferSelect): SessionSummary {
  const summary: {
    sessionID: Session.ID
    title: string
    directory: string
    created: string
    updated: string
    parentID?: Session.ID
  } = {
    sessionID: row.id,
    title: row.title || "(untitled)",
    directory: row.directory,
    created: formatTime(row.time_created),
    updated: formatTime(row.time_updated),
  }
  if (row.parent_id !== null) summary.parentID = row.parent_id
  return summary
}

function formatTime(ms: number) {
  return DateTime.formatIso(DateTime.makeUnsafe(ms)).slice(0, 16).replace("T", " ")
}

function sessionConditions(input: {
  readonly sessionID?: Session.ID
  readonly projectID?: Project.ID
  readonly directory?: string
  readonly subagents: boolean
}) {
  const conditions: SQL[] = []
  if (input.sessionID) conditions.push(eq(SessionTable.id, input.sessionID))
  if (input.projectID) conditions.push(eq(SessionTable.project_id, input.projectID))
  if (input.directory) {
    const dir = normalizeDir(input.directory)
    const prefix = dir === "/" ? "/%" : `${escapeLike(dir)}/%`
    conditions.push(sql`(${SessionTable.directory} = ${dir} OR ${SessionTable.directory} LIKE ${prefix} ESCAPE '\\')`)
  }
  if (!input.subagents) conditions.push(isNull(SessionTable.parent_id))
  return conditions
}

function normalizeDir(directory: string) {
  const slashed = directory.trim().replaceAll("\\", "/").replace(/\/+$/, "")
  return slashed || "/"
}

function escapeLike(value: string) {
  return value.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_")
}

function hasFtsSyntax(query: string) {
  return /["*]|\b(?:AND|OR|NOT)\b/.test(query)
}

function plainOrQuery(folded: string) {
  const terms = folded
    .split(/\s+/)
    .flatMap((raw) => {
      const cleaned = raw.replaceAll('"', "")
      if (!/[\p{L}\p{N}]/u.test(cleaned)) return []
      return [`"${cleaned}"`]
    })
  return terms.length > 0 ? terms.join(" OR ") : undefined
}

/**
 * Normalizes `text` the same way FTS5 + `Folds` index it while keeping a map back to original character offsets,
 * so the returned excerpt centers on accented or stemmed matches while preserving the original spelling.
 */
function makeSnippet(text: string, query: string) {
  const { normalized, offsets } = normalizeWithOffsets(text)
  const terms = Array.from(
    new Set(
      normalizeText(query)
        .split(/[^\p{L}\p{N}]+/u)
        .filter((term) => term.length > 0 && term !== "and" && term !== "or" && term !== "not"),
    ),
  ).toSorted((a, b) => b.length - a.length)

  const exact = terms.map((term) => normalized.indexOf(term)).find((at) => at >= 0)
  const stemmed =
    exact !== undefined
      ? exact
      : terms
          .map((term) => normalized.indexOf(stemPrefix(term)))
          .find((at) => at >= 0)
  const origin = stemmed !== undefined ? (offsets[stemmed] ?? 0) : 0
  const start = Math.max(0, origin - SNIPPET_CONTEXT)
  const end = Math.min(text.length, origin + SNIPPET_CONTEXT)
  const body = text.slice(start, end).replace(/\s+/g, " ").trim()
  return `${start > 0 ? "…" : ""}${body}${end < text.length ? "…" : ""}`
}

/** Strips common English inflection suffixes (including doubled consonants like `running` -> `run`) for snippet centering. */
function stemPrefix(term: string) {
  const stripped = term.replace(/(?:ies|ing|ed|es|s|ly|er|est|tion|ment|ness)$/, (suffix) =>
    term.length - suffix.length >= 3 ? "" : suffix,
  )
  const base = stripped.length >= 4 ? stripped.replace(/([bcdfghjklmnpqrstvwxyz])\1$/, "$1") : stripped
  return base.slice(0, Math.max(3, base.length))
}

function normalizeText(value: string) {
  return SessionSearchIndex.foldText(value)
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
}

function normalizeWithOffsets(value: string) {
  let normalized = ""
  const offsets: number[] = []
  let offset = 0
  for (const char of value) {
    const piece = normalizeText(char)
    for (let j = 0; j < piece.length; j++) {
      normalized += piece[j]
      offsets.push(offset)
    }
    offset += char.length
  }
  return { normalized, offsets }
}

function nonEmpty(text: string | undefined) {
  return text ? text : undefined
}

function cap(text: string | undefined, max: number) {
  if (!text) return undefined
  if (text.length <= max) return text
  return `${text.slice(0, max)}… [${text.length - max} more chars]`
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}
