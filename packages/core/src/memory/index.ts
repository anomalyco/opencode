import { Context, Effect, Layer } from "effect"
import { eq } from "drizzle-orm"
import { Database } from "../database/database"
import { MemoryTable } from "./sql"
import { Identifier } from "../id/id"
import { Location } from "../location"
import { makeLocationNode } from "../effect/app-node"
import * as MemorySchema from "./schema"
import { SessionSchema } from "../session/schema"

export * as MemorySchema from "./schema"

export interface Interface {
  readonly store: (content: string, source: "auto" | "manual", sessionID?: SessionSchema.ID) => Effect.Effect<MemorySchema.ID>
  readonly list: () => Effect.Effect<MemorySchema.Info[]>
  readonly delete: (id: MemorySchema.ID) => Effect.Effect<boolean>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/v2/Memory") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const { db } = yield* Database.Service
    const location = yield* Location.Service

    return Service.of({
      // Store a new memory string.
      // Source distinguishes between LLM-extracted memories ("auto") and user-provided ones ("manual").
      store: Effect.fn("Memory.store")(function* (content, source, sessionID) {
        const id = MemorySchema.ID.make(Identifier.ascending("memory"))
        yield* db.insert(MemoryTable).values({
          id,
          project_id: location.project.id,
          content,
          source,
          session_id: sessionID,
        })
        return id
      }),

      // Retrieve all memories for the current project.
      // This powers the system context injection for subsequent sessions.
      list: Effect.fn("Memory.list")(function* () {
        const rows = yield* db
          .select()
          .from(MemoryTable)
          .where(eq(MemoryTable.project_id, location.project.id))
        return rows.map((row) => ({
          id: MemorySchema.ID.make(row.id),
          projectID: row.project_id,
          content: row.content,
          source: row.source,
          sessionID: row.session_id ? row.session_id : undefined,
          timeCreated: row.time_created,
          timeUpdated: row.time_updated,
        }))
      }),

      // Remove a specific memory by its ID. Used when pruning outdated or incorrect memories.
      delete: Effect.fn("Memory.delete")(function* (id) {
        const result = yield* db.delete(MemoryTable).where(eq(MemoryTable.id, id))
        return result.rowsAffected > 0
      }),
    })
  }),
)

export const node = makeLocationNode({ service: Service, layer, deps: [Database.node, Location.node] })
