export * as PermissionDecisionsStore from "./permission-decisions-store"

import { Context, Effect, Layer, Schema } from "effect"
import { asc, eq } from "drizzle-orm"
import { Database } from "../database/database"
import { makeGlobalNode } from "../effect/app-node"
import { Identifier } from "../id/id"
import { PermissionDecisionsTable } from "./sql"
import type { SessionSchema } from "./schema"

// Audit trail for the LLM permission validator ("auto" mode): one row per
// decision, kept forever — the table doubles as the labeled dataset for
// validator evals, extractable by plain SQL.
export const Verdict = Schema.Literals(["allow", "deny", "uncertain", "fallback"])
export type Verdict = typeof Verdict.Type

export interface Insert {
  readonly sessionID: SessionSchema.ID
  readonly permission: string
  readonly patterns: string[]
  readonly metadata?: Record<string, unknown>
  readonly verdict: Verdict
  readonly reason?: string
  readonly model: string
  readonly latencyMs: number
}

export interface Info extends Insert {
  readonly id: string
  readonly createdAt: number
}

export interface Interface {
  readonly insert: (decision: Insert) => Effect.Effect<void>
  readonly listBySession: (sessionID: SessionSchema.ID) => Effect.Effect<Info[]>
}

function redactPatterns(patterns: readonly string[]) {
  return patterns.map((_, index) => `<redacted:${index + 1}>`)
}

function redactMetadata(metadata: Record<string, unknown> | undefined) {
  return typeof metadata?.callID === "string" ? { callID: metadata.callID } : undefined
}

export class Service extends Context.Service<Service, Interface>()("@opencode/v2/session/PermissionDecisionsStore") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const db = (yield* Database.Service).db

    const insert: Interface["insert"] = Effect.fn("PermissionDecisionsStore.insert")(function* (decision) {
      yield* db
        .insert(PermissionDecisionsTable)
        .values({
          id: Identifier.ascending("decision"),
          session_id: decision.sessionID,
          permission: decision.permission,
          patterns: redactPatterns(decision.patterns),
          metadata: redactMetadata(decision.metadata),
          verdict: decision.verdict,
          reason: decision.reason,
          model: decision.model,
          latency_ms: decision.latencyMs,
        })
        .run()
        .pipe(Effect.orDie)
    })

    const listBySession: Interface["listBySession"] = Effect.fn("PermissionDecisionsStore.listBySession")(
      function* (sessionID) {
        const rows = yield* db
          .select()
          .from(PermissionDecisionsTable)
          .where(eq(PermissionDecisionsTable.session_id, sessionID))
          .orderBy(asc(PermissionDecisionsTable.created_at), asc(PermissionDecisionsTable.id))
          .all()
          .pipe(Effect.orDie)
        return rows.map((row) => ({
          id: row.id,
          sessionID: row.session_id,
          permission: row.permission,
          patterns: redactPatterns(row.patterns),
          metadata: redactMetadata(row.metadata ?? undefined),
          verdict: row.verdict,
          reason: row.reason ?? undefined,
          model: row.model,
          latencyMs: row.latency_ms,
          createdAt: row.created_at,
        }))
      },
    )

    return Service.of({ insert, listBySession })
  }),
)

export const node = makeGlobalNode({ service: Service, layer, deps: [Database.node] })
