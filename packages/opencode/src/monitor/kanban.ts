/**
 * Kanban board: groups sessions into 5 columns.
 *
 *   Working    |   Waiting    |   Completed   |   Error   |   Abandoned
 *
 * Status mapping (derived from opencode's runtime + persisted state):
 *
 *   Working   — `SessionStatus.list` reports `busy | retry` for the session,
 *               AND the last `Assistant` message on the session has no
 *               `error` field.
 *   Waiting   — `SessionStatus.list` reports `idle`.
 *   Completed — `SessionTable.time_archived` is non-null, the last assistant
 *               message has no `error`, and the session is not errored.
 *   Error     — the last assistant message carries a non-null `error`.
 *   Abandoned — `SessionTable.time_archived` is non-null AND
 *               `SessionStatus` returns idle (no agent is actively watching).
 *
 * Cards surface the latest tool call (so users can see at a glance what the
 * session is doing) and roll up cost across all assistant messages.
 *
 * The shape contract is fixed by `KanbanBoard` / `KanbanCard` zod schemas;
 * the route validates the response before returning it to the client.
 */

import { z } from "zod"
import { Database, sql, isNull } from "@/storage"
import { SessionTable } from "@/session/session.sql"
import { SessionStatus } from "@/session/status"
import { Effect } from "effect"
import { catchCause, succeed } from "effect/Effect"

export const KanbanCard = z.object({
  session_id: z.string(),
  title: z.string(),
  status: z.enum(["working", "waiting", "completed", "error", "abandoned"]),
  model: z.string().nullable(),
  cost: z.number(),
  duration_ms: z.number(),
  last_tool: z.string().nullable(),
  parent_id: z.string().nullable(),
  parent_title: z.string().nullable(),
  time_started: z.number(),
  time_updated: z.number(),
})
export type KanbanCard = z.infer<typeof KanbanCard>

export const KanbanBoard = z.object({
  view: z.enum(["sessions", "agents"]),
  columns: z.object({
    working: z.array(KanbanCard),
    waiting: z.array(KanbanCard),
    completed: z.array(KanbanCard),
    error: z.array(KanbanCard),
    abandoned: z.array(KanbanCard),
  }),
  generated_at: z.number(),
})
export type KanbanBoard = z.infer<typeof KanbanBoard>

const COLUMN_LIMITS: Record<keyof KanbanBoard["columns"], number> = {
  working: 50,
  waiting: 50,
  completed: 30,
  error: 50,
  abandoned: 30,
}

interface SessionRow {
  id: string
  title: string
  parent_id: string | null
  time_created: number
  time_updated: number
  time_archived: number | null
}

interface AssistantRow {
  cost: number
  error: unknown
  time_created: number
  model: { providerID: string; modelID: string } | null
}

interface ToolPartRow {
  data: { type: string; tool?: string; state?: { status?: string; input?: unknown } }
}

function rollupCost(messages: AssistantRow[]): number {
  return messages.reduce((sum, m) => sum + (m.cost || 0), 0)
}

function lastError(messages: AssistantRow[]): unknown {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].error) return messages[i].error
  }
  return null
}

function lastTool(parts: ToolPartRow[]): string | null {
  for (let i = parts.length - 1; i >= 0; i--) {
    if (parts[i].data.type === "tool") return parts[i].data.tool ?? null
  }
  return null
}

function deriveStatus(
  row: SessionRow,
  messages: AssistantRow[],
  live: { working: boolean; waiting: boolean },
): KanbanCard["status"] {
  if (live.working) {
    return lastError(messages) ? "error" : "working"
  }
  if (live.waiting) return "waiting"
  if (row.time_archived) {
    return lastError(messages) ? "error" : "abandoned"
  }
  return lastError(messages) ? "error" : "completed"
}

/**
 * Effect that pulls the live status snapshot from the in-process bus.
 * Private — used by `buildKanban` only. Falls back to an empty map when
 * invoked outside an Instance scope (e.g. from a unit test) so the
 * function still completes with `working/waiting` columns empty.
 */
const liveSnapshot = SessionStatus.Service.use((svc) => svc.list()).pipe(
  catchCause(() => succeed(new Map<string, { type: string }>())),
)

/**
 * Build the kanban board. Pulls sessions + their last assistant message +
 * last tool part in three Drizzle queries (one per concern, no N+1 fan-out).
 */
export const buildKanban = Effect.fn(function* (input: { projectId: string; view: "sessions" | "agents" }) {
  // 1. Live status snapshot from the in-process bus.
  const live = yield* liveSnapshot
  const liveMap = new Map<string, "working" | "waiting">()
  for (const [sessionID, info] of live) {
    if (info.type === "busy" || info.type === "retry") liveMap.set(sessionID, "working")
    else if (info.type === "idle") liveMap.set(sessionID, "waiting")
  }

  // 2. Sessions for this project.
  const sessions = Database.use((db) =>
    db
      .select({
        id: SessionTable.id,
        title: SessionTable.title,
        parent_id: SessionTable.parent_id,
        time_created: SessionTable.time_created,
        time_updated: SessionTable.time_updated,
        time_archived: SessionTable.time_archived,
      })
      .from(SessionTable)
      .where(isNull(SessionTable.time_archived))
      .all()
  ) as SessionRow[]

  // 3. Last assistant message per session. We fetch the last 5 assistant
  // messages across all sessions and group client-side, which is cheap given
  // the message table is small per session.
  const assistantMessages: Record<string, AssistantRow[]> = {}
  if (sessions.length) {
    const ids = sessions.map((s) => s.id)
    const rows = Database.use((db) =>
      db.all<{
        session_id: string
        cost: number
        error: unknown
        time_created: number
        model: string
      }>(
        sql`SELECT session_id, json_extract(data, '$.cost') as cost,
                json_extract(data, '$.error') as error,
                json_extract(data, '$.time.created') as time_created,
                json_extract(data, '$.model') as model
         FROM message
         WHERE session_id IN (${sql.join(ids)}) AND json_extract(data, '$.role') = 'assistant'
         ORDER BY json_extract(data, '$.time.created') DESC
         LIMIT 500`,
      ),
    )
    for (const row of rows) {
      const list = assistantMessages[row.session_id] ?? (assistantMessages[row.session_id] = [])
      list.push({
        cost: Number(row.cost ?? 0),
        error: row.error,
        time_created: Number(row.time_created ?? 0),
        model: row.model ? (JSON.parse(row.model) as { providerID: string; modelID: string }) : null,
      })
    }
  }

  // 4. Last tool part per session.
  const lastToolBySession: Record<string, string | null> = {}
  if (sessions.length) {
    const ids = sessions.map((s) => s.id)
    const rows = Database.use((db) =>
      db.all<{ session_id: string; data: string; time_created: number }>(
        sql`SELECT session_id, data, json_extract(data, '$.time.start') as time_created
         FROM part
         WHERE session_id IN (${sql.join(ids)}) AND json_extract(data, '$.type') = 'tool'
         ORDER BY json_extract(data, '$.time.start') DESC
         LIMIT 500`,
      ),
    )
    for (const row of rows) {
      if (lastToolBySession[row.session_id] === undefined) {
        const data = JSON.parse(row.data) as ToolPartRow["data"]
        lastToolBySession[row.session_id] = data.tool ?? null
      }
    }
  }

  // 5. Parent title lookup. One extra query, only when there are parents.
  const parentTitleById: Record<string, string> = {}
  const parents = sessions.filter((s) => s.parent_id)
  if (parents.length) {
    const parentIds = Array.from(new Set(parents.map((p) => p.parent_id!)))
    const rows = Database.use((db) =>
      db.all<{ id: string; title: string }>(
        sql`SELECT id, title FROM session WHERE id IN (${sql.join(parentIds)})`,
      ),
    )
    for (const r of rows) parentTitleById[r.id] = r.title
  }

  // 6. Compose cards.
  const columns: KanbanBoard["columns"] = {
    working: [],
    waiting: [],
    completed: [],
    error: [],
    abandoned: [],
  }
  const now = Date.now()

  for (const session of sessions) {
    const liveStatus = liveMap.get(session.id)
    const messages = assistantMessages[session.id] ?? []
    const status = deriveStatus(session, messages, {
      working: liveStatus === "working",
      waiting: liveStatus === "waiting",
    })
    const last = messages[0]
    const card: KanbanCard = {
      session_id: session.id,
      title: session.title,
      status,
      model: last?.model ? `${last.model.providerID}/${last.model.modelID}` : null,
      cost: rollupCost(messages),
      duration_ms: now - session.time_created,
      last_tool: lastToolBySession[session.id] ?? null,
      parent_id: session.parent_id,
      parent_title: session.parent_id ? parentTitleById[session.parent_id] ?? null : null,
      time_started: session.time_created,
      time_updated: session.time_updated,
    }
    columns[status].push(card)
  }

  // Stable ordering: most-recently-updated first.
  for (const list of Object.values(columns)) {
    list.sort((a, b) => b.time_updated - a.time_updated)
  }
  for (const key of Object.keys(columns) as (keyof KanbanBoard["columns"])[]) {
    columns[key] = columns[key].slice(0, COLUMN_LIMITS[key])
  }

  return {
    view: input.view,
    columns,
    generated_at: now,
  } satisfies KanbanBoard
})
