import { Log } from "@/util/log"
import { Plugin } from "@/plugin"
import { Database, NotFoundError, eq } from "@/storage/db"
import type { SessionID } from "./schema"
import { SessionTable } from "./session.sql"
import { Effect } from "effect"

// Coordinates the "session.start" plugin hook for startup, resume, and compact
// triggers. All execution happens server-side inside Instance.provide() context.
//
// Storage note: append() and take() each do a SELECT then UPDATE in two
// statements. This is safe because OpenCode is a single-process Bun application
// with synchronous SQLite access via Database.use(). If this ever becomes
// multi-process, these helpers need to be wrapped in Database.transaction()
// or rewritten as single SQL statements.
export namespace SessionStart {
  const log = Log.create({ service: "session.start" })

  export type Trigger = "startup" | "resume" | "compact"

  function clean(input: string[]) {
    return input.map((item) => item.trim()).filter(Boolean)
  }

  export async function pending(sessionID: SessionID) {
    return Database.use((db) => {
      const row = db
        .select({ pending_context: SessionTable.pending_context })
        .from(SessionTable)
        .where(eq(SessionTable.id, sessionID))
        .get()
      if (!row) return []
      return [...(row.pending_context ?? [])]
    })
  }

  export async function clear(sessionID: SessionID) {
    Database.use((db) => {
      const row = db
        .update(SessionTable)
        .set({ pending_context: null })
        .where(eq(SessionTable.id, sessionID))
        .returning({ id: SessionTable.id })
        .get()
      if (!row) return
    })
  }

  export async function append(sessionID: SessionID, additionalContext: string[]) {
    const next = clean(additionalContext)
    if (next.length === 0) return []
    return Database.use((db) => {
      const row = db
        .select({ pending_context: SessionTable.pending_context })
        .from(SessionTable)
        .where(eq(SessionTable.id, sessionID))
        .get()
      if (!row) throw new NotFoundError({ message: `Session not found: ${sessionID}` })
      const pending = [...(row.pending_context ?? []), ...next]
      db.update(SessionTable).set({ pending_context: pending }).where(eq(SessionTable.id, sessionID)).run()
      return pending
    })
  }

  export async function take(sessionID: SessionID) {
    return Database.use((db) => {
      const row = db
        .select({ pending_context: SessionTable.pending_context })
        .from(SessionTable)
        .where(eq(SessionTable.id, sessionID))
        .get()
      if (!row) return []
      const pending = row.pending_context ?? []
      if (pending.length === 0) return []
      db.update(SessionTable).set({ pending_context: null }).where(eq(SessionTable.id, sessionID)).run()
      return [...pending]
    })
  }

  export async function consume(sessionID: SessionID, input: string[]) {
    const next = clean(input)
    if (next.length === 0) return []
    return Database.use((db) => {
      const row = db
        .select({ pending_context: SessionTable.pending_context })
        .from(SessionTable)
        .where(eq(SessionTable.id, sessionID))
        .get()
      if (!row) return []
      const pending = row.pending_context ?? []
      if (pending.length === 0) return []
      if (!next.every((item, i) => pending[i] === item)) return [...pending]
      const rest = pending.slice(next.length)
      db.update(SessionTable)
        .set({ pending_context: rest.length > 0 ? rest : null })
        .where(eq(SessionTable.id, sessionID))
        .run()
      return rest
    })
  }

  export async function trigger(input: { sessionID: SessionID; trigger: Trigger }) {
    const output = { additionalContext: [] as string[] }
    // Lazy import to avoid circular module initialization (AppRuntime → ShareNext → Session)
    const { AppRuntime } = await import("@/effect/app-runtime")
    const hooks = await AppRuntime.runPromise(
      Effect.gen(function* () {
        const plugin = yield* Plugin.Service
        return yield* plugin.list()
      }),
    )
    for (const hook of hooks) {
      const fn = hook["session.start"]
      if (!fn) continue
      try {
        await fn(input, output)
      } catch (err) {
        log.error("hook failed", {
          sessionID: input.sessionID,
          trigger: input.trigger,
          error: err,
        })
      }
    }
    return append(input.sessionID, output.additionalContext)
  }
}
