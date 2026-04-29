import { startWorkspaceSyncing } from "@/control-plane/workspace"
import * as InstanceState from "@/effect/instance-state"
import { Database } from "@/storage/db"
import { asc } from "drizzle-orm"
import { and } from "drizzle-orm"
import { eq } from "drizzle-orm"
import { lte } from "drizzle-orm"
import { not } from "drizzle-orm"
import { or } from "drizzle-orm"
import { SyncEvent } from "@/sync"
import { EventTable } from "@/sync/event.sql"
import { NonNegativeInt } from "@/util/schema"
import { Effect, Schema } from "effect"
import { HttpApi, HttpApiBuilder, HttpApiEndpoint, HttpApiError, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"
import { Authorization } from "./auth"

const root = "/sync"
const ReplayEvent = Schema.Struct({
  id: Schema.String,
  aggregateID: Schema.String,
  seq: NonNegativeInt,
  type: Schema.String,
  data: Schema.Record(Schema.String, Schema.Unknown),
}).annotate({ identifier: "SyncReplayEvent" })
const ReplayPayload = Schema.Struct({
  directory: Schema.String,
  events: Schema.NonEmptyArray(ReplayEvent),
}).annotate({ identifier: "SyncReplayInput" })
const ReplayResponse = Schema.Struct({
  sessionID: Schema.String,
}).annotate({ identifier: "SyncReplayResponse" })
const HistoryPayload = Schema.Record(Schema.String, NonNegativeInt)
const HistoryEvent = Schema.Struct({
  id: Schema.String,
  aggregate_id: Schema.String,
  seq: Schema.Number,
  type: Schema.String,
  data: Schema.Record(Schema.String, Schema.Unknown),
}).annotate({ identifier: "SyncHistoryEvent" })

export const SyncPaths = {
  start: `${root}/start`,
  replay: `${root}/replay`,
  history: `${root}/history`,
} as const

export const SyncApi = HttpApi.make("sync")
  .add(
    HttpApiGroup.make("sync")
      .add(
        HttpApiEndpoint.post("start", SyncPaths.start, {
          success: Schema.Boolean,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "sync.start",
            summary: "Start workspace sync",
            description: "Start sync loops for workspaces in the current project that have active sessions.",
          }),
        ),
        HttpApiEndpoint.post("replay", SyncPaths.replay, {
          payload: ReplayPayload,
          success: ReplayResponse,
          error: HttpApiError.BadRequest,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "sync.replay",
            summary: "Replay sync events",
            description: "Validate and replay a complete sync event history.",
          }),
        ),
        HttpApiEndpoint.post("history", SyncPaths.history, {
          payload: HistoryPayload,
          success: Schema.Array(HistoryEvent),
          error: HttpApiError.BadRequest,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "sync.history.list",
            summary: "List sync events",
            description:
              "List sync events for all aggregates. Keys are aggregate IDs the client already knows about, values are the last known sequence ID. Events with seq > value are returned for those aggregates. Aggregates not listed in the input get their full history.",
          }),
        ),
      )
      .annotateMerge(
        OpenApi.annotations({
          title: "sync",
          description: "Experimental HttpApi sync routes.",
        }),
      )
      .middleware(Authorization),
  )
  .annotateMerge(
    OpenApi.annotations({
      title: "opencode experimental HttpApi",
      version: "0.0.1",
      description: "Experimental HttpApi surface for selected instance routes.",
    }),
  )

export const syncHandlers = HttpApiBuilder.group(SyncApi, "sync", (handlers) =>
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
