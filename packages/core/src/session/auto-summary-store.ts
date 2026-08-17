export * as AutoSummaryStore from "./auto-summary-store"

import { Context, Effect, Layer } from "effect"
import { eq, sql } from "drizzle-orm"
import { Database } from "../database/database"
import { makeGlobalNode } from "../effect/app-node"
import { SessionAutoSummaryTable } from "./sql"
import type { SessionSchema } from "./schema"

// Incremental per-session summary maintained by the hidden session-summarizer
// agent in "auto" mode; the permission validator reads the latest row on every
// validation. Lives outside the transcript, one row per session.
export interface Upsert {
  readonly sessionID: SessionSchema.ID
  readonly summary: string
  readonly model: string
  readonly turnCount: number
}

export interface Info extends Upsert {
  readonly updatedAt: number
}

export interface Interface {
  readonly upsert: (input: Upsert) => Effect.Effect<void>
  readonly get: (sessionID: SessionSchema.ID) => Effect.Effect<Info | undefined>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/v2/session/AutoSummaryStore") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const db = (yield* Database.Service).db

    const upsert: Interface["upsert"] = Effect.fn("AutoSummaryStore.upsert")(function* (input) {
      const now = Date.now()
      yield* db
        .insert(SessionAutoSummaryTable)
        .values({
          session_id: input.sessionID,
          summary: input.summary,
          model: input.model,
          turn_count: input.turnCount,
          updated_at: now,
        })
        .onConflictDoUpdate({
          target: SessionAutoSummaryTable.session_id,
          set: { summary: input.summary, model: input.model, turn_count: input.turnCount, updated_at: now },
          // A stale writer (an older summarizer flight landing last) must
          // never regress the incorporated turn count.
          where: sql`${SessionAutoSummaryTable.turn_count} <= excluded.turn_count`,
        })
        .run()
        .pipe(Effect.orDie)
    })

    const get: Interface["get"] = Effect.fn("AutoSummaryStore.get")(function* (sessionID) {
      const row = yield* db
        .select()
        .from(SessionAutoSummaryTable)
        .where(eq(SessionAutoSummaryTable.session_id, sessionID))
        .get()
        .pipe(Effect.orDie)
      if (!row) return undefined
      return {
        sessionID: row.session_id,
        summary: row.summary,
        model: row.model,
        turnCount: row.turn_count,
        updatedAt: row.updated_at,
      }
    })

    return Service.of({ upsert, get })
  }),
)

export const node = makeGlobalNode({ service: Service, layer, deps: [Database.node] })
