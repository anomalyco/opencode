import { startWorkspaceSyncing } from "@/control-plane/workspace"
import * as InstanceState from "@/effect/instance-state"
import { Database } from "@/storage/db"
import { SyncEvent } from "@/sync"
import { EventTable } from "@/sync/event.sql"
import { asc } from "drizzle-orm"
import { and } from "drizzle-orm"
import { eq } from "drizzle-orm"
import { lte } from "drizzle-orm"
import { not } from "drizzle-orm"
import { or } from "drizzle-orm"
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { InstanceHttpApi } from "../api"
import { HistoryPayload, ReplayPayload } from "../groups/sync"

export const syncHandlers = HttpApiBuilder.group(InstanceHttpApi, "sync", (handlers) =>
  Effect.gen(function* () {
    const start = Effect.fn("SyncHttpApi.start")(function* () {
      startWorkspaceSyncing((yield* InstanceState.context).project.id)
      return true
    })

    const replay = Effect.fn("SyncHttpApi.replay")(function* (ctx: { payload: typeof ReplayPayload.Type }) {
      const events: SyncEvent.SerializedEvent[] = ctx.payload.events.map((event) => ({
        id: event.id,
        aggregateID: event.aggregateID,
        seq: event.seq,
        type: event.type,
        data: { ...event.data },
      }))
      SyncEvent.replayAll(events)
      return { sessionID: events[0].aggregateID }
    })

    const history = Effect.fn("SyncHttpApi.history")(function* (ctx: { payload: typeof HistoryPayload.Type }) {
      const exclude = Object.entries(ctx.payload)
      return Database.use((db) =>
        db
          .select()
          .from(EventTable)
          .where(
            exclude.length > 0
              ? not(or(...exclude.map(([id, seq]) => and(eq(EventTable.aggregate_id, id), lte(EventTable.seq, seq))))!)
              : undefined,
          )
          .orderBy(asc(EventTable.seq))
          .all(),
      )
    })

    return handlers.handle("start", start).handle("replay", replay).handle("history", history)
  }),
)
