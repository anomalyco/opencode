export * as SessionStatusStore from "./status-store"

import { Context, Effect, Layer, Schema } from "effect"
import { and, desc, eq } from "drizzle-orm"
import { Database } from "../database/database"
import { makeGlobalNode } from "../effect/app-node"
import { MessageTable, PartTable, SessionStatusTable } from "./sql"
import type { SessionSchema } from "./schema"

// Persisted per-session status for the cross-project sessions list. Unlike the
// runtime SessionStatus map this survives process restarts; writers converge
// last-writer-wins on the session_id row. "interrupted" is never stored — it
// is derived at read time for active rows whose writer process is gone.
export const Status = Schema.Literals(["working", "retrying", "needs_input", "done", "idle", "interrupted"])
export type Status = typeof Status.Type

export const Info = Schema.Struct({
  sessionID: Schema.String,
  status: Status,
  detail: Schema.optional(Schema.String),
  time: Schema.Struct({ created: Schema.Number, updated: Schema.Number }),
})
export type Info = typeof Info.Type

// Internal row shape: list() also exposes the writer PID so readers can tell
// whether the process behind an active status is still alive.
export interface Row extends Info {
  readonly pid: number | null
}

export interface Interface {
  readonly set: (sessionID: SessionSchema.ID, status: Status, detail?: string) => Effect.Effect<void>
  readonly setIdle: (sessionID: SessionSchema.ID) => Effect.Effect<void>
  readonly list: () => Effect.Effect<Row[]>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/v2/session/SessionStatusStore") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const db = (yield* Database.Service).db

    // Skip the write when nothing changed so time_updated keeps meaning "when
    // the status last changed" — the sessions list ages colors by it.
    const set: Interface["set"] = Effect.fn("SessionStatusStore.set")(function* (sessionID, status, detail) {
      const existing = yield* db
        .select()
        .from(SessionStatusTable)
        .where(eq(SessionStatusTable.session_id, sessionID))
        .get()
        .pipe(Effect.orDie)
      if (existing && existing.status === status && (existing.detail ?? undefined) === detail) return
      yield* db
        .insert(SessionStatusTable)
        .values({ session_id: sessionID, status, detail, pid: process.pid })
        .onConflictDoUpdate({
          target: SessionStatusTable.session_id,
          set: { status, detail: detail ?? null, pid: process.pid, time_updated: Date.now() },
        })
        .run()
        .pipe(Effect.orDie)
    })

    // A session that goes idle after a completed assistant message counts as
    // "done" and carries the first line of its last text as the detail;
    // anything else (abort, error, user message last) is a plain idle.
    const setIdle: Interface["setIdle"] = Effect.fn("SessionStatusStore.setIdle")(function* (sessionID) {
      const message = yield* db
        .select()
        .from(MessageTable)
        .where(eq(MessageTable.session_id, sessionID))
        .orderBy(desc(MessageTable.time_created), desc(MessageTable.id))
        .get()
        .pipe(Effect.orDie)
      if (!message) return yield* set(sessionID, "idle")
      const data = message.data as { role?: string; time?: { completed?: number } }
      if (data.role !== "assistant" || data.time?.completed === undefined) {
        return yield* set(sessionID, "idle")
      }
      const parts = yield* db
        .select()
        .from(PartTable)
        .where(and(eq(PartTable.session_id, sessionID), eq(PartTable.message_id, message.id)))
        .orderBy(desc(PartTable.time_created), desc(PartTable.id))
        .limit(20)
        .all()
        .pipe(Effect.orDie)
      const text = parts.flatMap((part) => {
        const data = part.data as { type?: string; text?: string }
        return data.type === "text" && data.text ? [data.text] : []
      })[0]
      const detail = text
        ?.split("\n")
        .map((line) => line.trim())
        .find((line) => line.length > 0)
        ?.slice(0, 120)
      return yield* set(sessionID, "done", detail)
    })

    const list: Interface["list"] = Effect.fn("SessionStatusStore.list")(function* () {
      // Bounded so the sessions list never downloads the full history; only
      // recently touched sessions have a status worth showing anyway.
      const rows = yield* db
        .select()
        .from(SessionStatusTable)
        .orderBy(desc(SessionStatusTable.time_updated))
        .limit(1000)
        .all()
        .pipe(Effect.orDie)
      return rows.map((row) => ({
        sessionID: row.session_id,
        status: row.status,
        detail: row.detail ?? undefined,
        pid: row.pid,
        time: { created: row.time_created, updated: row.time_updated },
      }))
    })

    return Service.of({ set, setIdle, list })
  }),
)

export const node = makeGlobalNode({ service: Service, layer, deps: [Database.node] })
