import { Context, Effect, Layer } from "effect"
import { eq, lt } from "drizzle-orm"
import { Database } from "@opencode-ai/core/database/database"
import { memoryTable } from "./memory.sql"
import * as Log from "@opencode-ai/core/util/log"
import type { MemoryRow } from "./memory-store"

const log = Log.create({ service: "memory.decay" })

export interface Interface {
  readonly run: () => Effect.Effect<{ decayed: number; purged: number }>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/SelfImprovement/Decay") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const { db } = yield* Database.Service

    const run = Effect.fn("Decay.run")(function* () {
      const candidates = yield* db
        .select()
        .from(memoryTable)
        .where(lt(memoryTable.importance, 0.3))
        .all()
        .pipe(Effect.orDie)

      let decayed = 0
      let purged = 0

      for (const row of candidates) {
        const newImportance = row.importance * 0.9
        if (newImportance < 0.1) {
          yield* db.delete(memoryTable).where(eq(memoryTable.id, row.id)).run().pipe(Effect.orDie)
          purged++
        } else {
          yield* db
            .update(memoryTable)
            .set({ importance: newImportance })
            .where(eq(memoryTable.id, row.id))
            .run()
            .pipe(Effect.orDie)
          decayed++
        }
      }

      log.info("decay run complete", { decayed, purged })
      return { decayed, purged }
    })

    return Service.of({ run })
  }),
)

export const defaultLayer = Layer.provide(layer, Database.defaultLayer)

export * as Decay from "./decay"
