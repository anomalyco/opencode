import { SYNC_HISTORY_LIMIT, Workspace } from "@/control-plane/workspace"
import * as InstanceState from "@/effect/instance-state"
import { Session } from "@/session/session"
import { NotFoundError } from "@/storage/storage"
import { Database } from "@opencode-ai/core/database/database"
import { EventV2 } from "@opencode-ai/core/event"
import { EventV2Bridge } from "@/event-v2-bridge"
import { EventTable } from "@opencode-ai/core/event/sql"
import { asc } from "drizzle-orm"
import { and } from "drizzle-orm"
import { eq } from "drizzle-orm"
import { lte } from "drizzle-orm"
import { not } from "drizzle-orm"
import { or } from "drizzle-orm"
import { Effect, Scope } from "effect"
import { HttpApiBuilder, HttpApiError } from "effect/unstable/httpapi"
import { InstanceHttpApi } from "../api"
import { ForbiddenError, SessionNotFoundError } from "../errors"
import { HistoryPayload, ReplayPayload, SessionPayload } from "../groups/sync"

// A history map with more keys than this builds an equivalently large `OR`
// chain against the single serialized SQLite writer; the sync client sends one
// key per session it knows about, so this is far above any legitimate request.
export const SYNC_HISTORY_MAX_KEYS = 500

export const syncHandlers = HttpApiBuilder.group(InstanceHttpApi, "sync", (handlers) =>
  Effect.gen(function* () {
    const workspace = yield* Workspace.Service
    const session = yield* Session.Service
    const scope = yield* Scope.Scope
    const events = yield* EventV2Bridge.Service
    const { db } = yield* Database.Service

    const start = Effect.fn("SyncHttpApi.start")(function* () {
      yield* workspace
        .startWorkspaceSyncing((yield* InstanceState.context).project.id)
        .pipe(Effect.ignore, Effect.forkIn(scope))
      return true
    })

    const replay = Effect.fn("SyncHttpApi.replay")(function* (ctx: { payload: typeof ReplayPayload.Type }) {
      const payload: EventV2.SerializedEvent[] = ctx.payload.events.map((event) => ({
        id: event.id,
        aggregateID: event.aggregateID,
        seq: event.seq,
        type: event.type,
        data: { ...event.data },
      }))
      if (payload.length === 0) return yield* new HttpApiError.BadRequest({})
      const source = payload[0].aggregateID
      yield* Effect.logInfo("sync replay requested", {
        sessionID: source,
        events: payload.length,
        first: payload[0]?.seq,
        last: payload.at(-1)?.seq,
        directory: ctx.payload.directory,
      })
      const ownerID = yield* InstanceState.workspaceID
      yield* events.replayAll(payload, { ownerID, strictOwner: true })
      yield* Effect.logInfo("sync replay complete", {
        sessionID: source,
        events: payload.length,
        first: payload[0]?.seq,
        last: payload.at(-1)?.seq,
      })
      return { sessionID: source }
    })

    const steal = Effect.fn("SyncHttpApi.steal")(function* (ctx: { payload: typeof SessionPayload.Type }) {
      const workspaceID = yield* InstanceState.workspaceID
      if (!workspaceID) return yield* new HttpApiError.BadRequest({})

      const instance = yield* InstanceState.context
      const info = yield* session.get(ctx.payload.sessionID).pipe(
        Effect.catchIf(
          (error): error is NotFoundError => NotFoundError.isInstance(error),
          () => Effect.succeed(undefined),
        ),
        Effect.catchDefect(() => Effect.succeed(undefined)),
      )
      if (!info) {
        return yield* new SessionNotFoundError({
          sessionID: ctx.payload.sessionID,
          message: `Session not found: ${ctx.payload.sessionID}`,
        })
      }
      if (info.projectID !== instance.project.id) {
        return yield* new ForbiddenError({ message: "Session belongs to a different project" })
      }

      yield* session.setWorkspace({ sessionID: ctx.payload.sessionID, workspaceID })

      yield* Effect.logInfo("sync session stolen", { sessionID: ctx.payload.sessionID, workspaceID })

      return { sessionID: ctx.payload.sessionID }
    })

    const history = Effect.fn("SyncHttpApi.history")(function* (ctx: { payload: typeof HistoryPayload.Type }) {
      const exclude = Object.entries(ctx.payload)
      if (exclude.length > SYNC_HISTORY_MAX_KEYS) return yield* new HttpApiError.BadRequest({})
      // An empty map means the client knows no aggregates yet, so there is
      // nothing to reconcile. Returning the globally oldest events here would
      // leak every session, directory and project sharing the database.
      if (exclude.length === 0) return []
      return yield* db
        .select()
        .from(EventTable)
        .where(not(or(...exclude.map(([id, seq]) => and(eq(EventTable.aggregate_id, id), lte(EventTable.seq, seq))))!))
        .orderBy(asc(EventTable.seq))
        .limit(SYNC_HISTORY_LIMIT)
        .all()
        .pipe(Effect.orDie)
    })

    return handlers.handle("start", start).handle("replay", replay).handle("steal", steal).handle("history", history)
  }),
)
