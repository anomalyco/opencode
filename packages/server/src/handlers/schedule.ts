import { Permission } from "@opencode/core/permission"
import { Schedule } from "@opencode/core/schedule"
import type { Session } from "@opencode/core/session"
import {
  ForbiddenError,
  InvalidRequestError,
  ScheduleNotFoundError,
  ScheduleRunNotFoundError,
} from "@opencode/protocol/errors"
import type { CreatePayload, InboxQuery, RunsQuery } from "@opencode/protocol/groups/schedule"
import { Effect } from "effect"
import { HttpApiSchema } from "effect/http-api"
import { missingSession } from "./session-error"

/** `schedule.*` in the `server.experimental` group. Every route needs experimental.schedules where the Session lives. */
export const makeSchedule = Effect.gen(function* () {
  const schedules = yield* Schedule.Service

  const allowed = (sessionID: Session.ID) =>
    schedules.enabled(sessionID).pipe(
      Effect.mapError(missingSession),
      Effect.flatMap((enabled) => (enabled ? Effect.void : Effect.fail(disabled()))),
    )

  // A schedule whose Session is gone, or whose location has the flag off, reads as missing or forbidden like the rest.
  const find = (id: Schedule.ID) =>
    Effect.gen(function* () {
      const info = yield* schedules.get(id).pipe(Effect.mapError(missingSchedule))
      if (info.sessionID === undefined) return yield* missingSchedule({ scheduleID: id })
      yield* allowed(info.sessionID).pipe(
        Effect.catchTag("SessionNotFoundError", () => Effect.fail(missingSchedule({ scheduleID: id }))),
      )
      return info
    })

  return {
    create: (payload: CreatePayload) =>
      // Stateless HTTP callers have no guaranteed UI listener to answer an interactive ask, so settle asks unattended.
      Schedule.fromRequest(payload.sessionID, payload).pipe(
        Effect.flatMap((input) => schedules.create(input)),
        Effect.provideService(Permission.Unattended, []),
        Effect.map((data) => ({ data })),
        Effect.catchTags({
          "Schedule.InvalidError": (error) =>
            Effect.fail(new InvalidRequestError({ message: error.message, kind: "schedule" })),
          "Schedule.DisabledError": () => Effect.fail(disabled()),
          "Permission.BlockedError": (error) => Effect.fail(new ForbiddenError({ message: error.message })),
          "Permission.CorrectedError": (error) => Effect.fail(new ForbiddenError({ message: error.feedback })),
          "Session.NotFoundError": (error) => Effect.fail(missingSession(error)),
        }),
      ),
    list: (sessionID: Session.ID) =>
      allowed(sessionID).pipe(
        Effect.andThen(schedules.list({ sessionID })),
        Effect.map((data) => ({ data })),
      ),
    inbox: (query: InboxQuery) =>
      Effect.gen(function* () {
        if (query.sessionID !== undefined) {
          yield* allowed(query.sessionID)
          const data = yield* schedules.inbox({
            sessionID: query.sessionID,
            includeRead: query.includeRead,
            limit: query.limit,
          })
          return { data }
        }
        const targetLimit = query.limit ?? 50
        const items = yield* schedules.inbox({
          includeRead: query.includeRead,
          limit: Math.max(targetLimit * 4, 200),
        })
        const cache = new Map<Session.ID, boolean>()
        const data: Schedule.Run[] = []
        for (const item of items) {
          if (item.ownerSessionID === undefined) continue
          let on = cache.get(item.ownerSessionID)
          if (on === undefined) {
            on = yield* schedules.enabled(item.ownerSessionID).pipe(
              Effect.catchTag("Session.NotFoundError", () => Effect.succeed(false)),
            )
            cache.set(item.ownerSessionID, on)
          }
          if (on) {
            data.push(item)
            if (data.length >= targetLimit) break
          }
        }
        return { data }
      }),
    runs: (id: Schedule.ID, query: RunsQuery) =>
      find(id).pipe(
        Effect.andThen(schedules.runs({ scheduleID: id, limit: query.limit })),
        Effect.map((data) => ({ data })),
      ),
    markRead: (runID: Schedule.RunID) =>
      Effect.gen(function* () {
        const existing = yield* schedules.getRun(runID).pipe(Effect.mapError(missingRun))
        if (existing.ownerSessionID === undefined) return yield* missingRun({ runID })
        yield* allowed(existing.ownerSessionID).pipe(
          Effect.catchTag("SessionNotFoundError", () => Effect.fail(missingRun({ runID }))),
        )
        const data = yield* schedules.markRead(runID).pipe(Effect.mapError(missingRun))
        return { data }
      }),
    get: (id: Schedule.ID) => find(id).pipe(Effect.map((data) => ({ data }))),
    pause: (id: Schedule.ID) =>
      find(id).pipe(
        Effect.andThen(schedules.pause(id).pipe(Effect.mapError(missingSchedule))),
        Effect.map((data) => ({ data })),
      ),
    resume: (id: Schedule.ID) =>
      find(id).pipe(
        Effect.andThen(schedules.resume(id).pipe(Effect.mapError(missingSchedule))),
        Effect.map((data) => ({ data })),
      ),
    remove: (id: Schedule.ID) =>
      find(id).pipe(
        Effect.andThen(schedules.remove(id).pipe(Effect.mapError(missingSchedule))),
        Effect.as(HttpApiSchema.NoContent.make()),
      ),
  }
})

function missingSchedule(error: { readonly scheduleID: Schedule.ID }) {
  return new ScheduleNotFoundError({ scheduleID: error.scheduleID, message: `Schedule not found: ${error.scheduleID}` })
}

function missingRun(error: { readonly runID: Schedule.RunID }) {
  return new ScheduleRunNotFoundError({ runID: error.runID, message: `Schedule run not found: ${error.runID}` })
}

function disabled() {
  return new ForbiddenError({ message: new Schedule.DisabledError().message })
}
