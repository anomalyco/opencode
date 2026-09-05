import { Database } from "@opencode-ai/core/database/database"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { MessageTable, PartTable } from "@opencode-ai/core/session/sql"
import { inArray, max } from "drizzle-orm"
import { Context, Effect, Layer } from "effect"
import type { SessionID } from "../schema"
import type { SessionClosureModel as Model } from "./model"
import type { SessionClosurePorts as Ports } from "./ports"

/**
 * Reads each Session's persisted Message/Part timestamp high-water. This stays separate from
 * identity because V1 payload reconstruction does not expose physical timestamp columns.
 *
 * Sessions with no rows are omitted rather than reported as zero, preserving absence for the driver.
 */
export interface Interface extends Ports.HighWaterCapability {}

export class Service extends Context.Service<Service, Interface>()("@opencode/SessionClosureHighWater") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const { db } = yield* Database.Service

    return Service.of({
      read: (targets) =>
        Effect.gen(function* () {
          if (targets.length === 0) return []

          const ids = targets.map((target) => String(target) as SessionID)
          // Reads degrade independently so a high-water failure does not mask an earlier identity failure.
          const messages = yield* db
            .select({
              session: MessageTable.session_id,
              created: max(MessageTable.time_created),
              updated: max(MessageTable.time_updated),
            })
            .from(MessageTable)
            .where(inArray(MessageTable.session_id, ids))
            .groupBy(MessageTable.session_id)
            .all()
            .pipe(Effect.orElseSucceed(() => []))
          const parts = yield* db
            .select({
              session: PartTable.session_id,
              created: max(PartTable.time_created),
              updated: max(PartTable.time_updated),
            })
            .from(PartTable)
            .where(inArray(PartTable.session_id, ids))
            .groupBy(PartTable.session_id)
            .all()
            .pipe(Effect.orElseSucceed(() => []))

          const values = new Map<string, number>()
          for (const row of [...messages, ...parts]) {
            const millis = Math.max(row.created ?? 0, row.updated ?? 0)
            values.set(row.session, Math.max(values.get(row.session) ?? 0, millis))
          }

          // Preserve the caller's branded Session identity.
          return targets.flatMap((session) => {
            const millis = values.get(String(session))
            return millis === undefined ? [] : [{ session, millis }]
          })
        }),
    })
  }),
)

export const node = LayerNode.make({ service: Service, layer, deps: [Database.node] })

export * as SessionClosureHighWater from "./high-water"
