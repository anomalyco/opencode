export * as TitleHistoryStore from "./title-history-store"

import { Context, Effect, Layer, Schema } from "effect"
import { asc, eq } from "drizzle-orm"
import { Database } from "../database/database"
import { makeGlobalNode } from "../effect/app-node"
import { Identifier } from "../id/id"
import { SessionTitleHistoryTable } from "./sql"
import type { SessionSchema } from "./schema"
import type { MessageID } from "../v1/session"

// Audit trail of session title changes: every write (manual rename or LLM
// retitle) appends one row, kept forever.
export const Source = Schema.Literals(["user", "llm"])
export type Source = typeof Source.Type

export interface Insert {
  readonly sessionID: SessionSchema.ID
  readonly title: string
  readonly source: Source
  readonly model?: string
  readonly triggerMessageID?: MessageID
}

export interface Info extends Insert {
  readonly id: string
  readonly createdAt: number
}

export interface Interface {
  readonly insert: (entry: Insert) => Effect.Effect<void>
  readonly listBySession: (sessionID: SessionSchema.ID) => Effect.Effect<Info[]>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/v2/session/TitleHistoryStore") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const db = (yield* Database.Service).db

    const insert: Interface["insert"] = Effect.fn("TitleHistoryStore.insert")(function* (entry) {
      yield* db
        .insert(SessionTitleHistoryTable)
        .values({
          id: Identifier.ascending("titleHistory"),
          session_id: entry.sessionID,
          title: entry.title,
          source: entry.source,
          model: entry.model,
          trigger_message_id: entry.triggerMessageID,
        })
        .run()
        .pipe(Effect.orDie)
    })

    const listBySession: Interface["listBySession"] = Effect.fn("TitleHistoryStore.listBySession")(
      function* (sessionID) {
        const rows = yield* db
          .select()
          .from(SessionTitleHistoryTable)
          .where(eq(SessionTitleHistoryTable.session_id, sessionID))
          .orderBy(asc(SessionTitleHistoryTable.created_at), asc(SessionTitleHistoryTable.id))
          .all()
          .pipe(Effect.orDie)
        return rows.map((row) => ({
          id: row.id,
          sessionID: row.session_id,
          title: row.title,
          source: row.source,
          model: row.model ?? undefined,
          triggerMessageID: row.trigger_message_id ?? undefined,
          createdAt: row.created_at,
        }))
      },
    )

    return Service.of({ insert, listBySession })
  }),
)

export const node = makeGlobalNode({ service: Service, layer, deps: [Database.node] })
