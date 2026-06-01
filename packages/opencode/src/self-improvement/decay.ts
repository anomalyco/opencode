import { Context, Effect, Layer } from "effect"
import { lt, eq } from "@/storage/db"
import * as Database from "@/storage/db"
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
    const run = Effect.fn("Decay.run")(function* () {
      const candidates = Database.Client()
        .select()
        .from(memoryTable)
        .where(lt(memoryTable.importance, 0.3) as any)
        .all() as MemoryRow[]

      let decayed = 0
      let purged = 0

      for (const row of candidates) {
        const newImportance = row.importance * 0.9
        if (newImportance < 0.1) {
          Database.Client().delete(memoryTable).where(eq(memoryTable.id, row.id) as any).run()
          purged++
        } else {
          Database.Client()
            .update(memoryTable)
            .set({ importance: newImportance })
            .where(eq(memoryTable.id, row.id) as any)
            .run()
          decayed++
        }
      }

      log.info("decay run complete", { decayed, purged })
      return { decayed, purged }
    })

    return Service.of({ run })
  }),
)

export const defaultLayer = layer

export * as Decay from "./decay"
