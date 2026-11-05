import { Permission } from "@opencode/core/permission"
import { Schedule } from "@opencode/core/schedule"
import type { Session } from "@opencode/core/session"
import { ForbiddenError, InvalidRequestError, ScheduleNotFoundError } from "@opencode/protocol/errors"
import type { CreatePayload } from "@opencode/protocol/groups/schedule"
import { Effect } from "effect"
import { HttpApiSchema } from "effect/http-api"
import { missingSession } from "./session-error"

/**
 * `schedule.*` in the `server.experimental` group. Session routes need experimental.schedules where the Session lives;
 * a create, read or list without a `sessionID` needs it in the global config.
 */
export const makeSchedule = Effect.gen(function* () {
  const schedules = yield* Schedule.Service

  const allowed = (sessionID?: Session.ID) =>
    schedules.enabled(sessionID).pipe(
      Effect.mapError(missingSession),
      Effect.flatMap((enabled) => (enabled ? Effect.void : Effect.fail(disabled()))),
    )

  // A schedule whose Session is gone reads as missing; one whose location (or the global config) has the flag off is
  // forbidden like the rest.
  const find = (id: Schedule.ID) =>
    Effect.gen(function* () {
      const info = yield* schedules.get(id).pipe(Effect.mapError(missingSchedule))
      yield* allowed(info.sessionID).pipe(
        Effect.catchTag("SessionNotFoundError", () => Effect.fail(missingSchedule({ scheduleID: id }))),
      )
      return info
    })

  // A session-less list spans every location, so hide rows whose Session lives where the flag is off. Distinct Sessions
  // are deduped, keeping it to one enabled check and one config read per location.
  const hiddenSessions = (data: ReadonlyArray<Schedule.Info>) =>
    Effect.forEach(
      new Set(data.flatMap((row) => (row.sessionID === undefined ? [] : [row.sessionID]))),
      (sessionID) =>
        schedules.enabled(sessionID).pipe(
          Effect.catchTag("Session.NotFoundError", () => Effect.succeed(false)),
          Effect.map((enabled) => (enabled ? [] : [sessionID])),
        ),
      { concurrency: "unbounded" },
    ).pipe(Effect.map((groups) => new Set(groups.flat())))

  return {
    create: (payload: CreatePayload) =>
      // Stateless HTTP callers have no guaranteed UI listener to answer an interactive ask, so settle asks unattended.
      schedules.create(Schedule.toCreateInput(payload.sessionID, payload)).pipe(
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
    list: (sessionID?: Session.ID) =>
      allowed(sessionID).pipe(
        Effect.andThen(schedules.list({ sessionID })),
        Effect.flatMap((data) => {
          if (sessionID !== undefined) return Effect.succeed({ data })
          return hiddenSessions(data).pipe(
            Effect.map((hidden) => ({
              data: data.filter((row) => row.sessionID === undefined || !hidden.has(row.sessionID)),
            })),
          )
        }),
      ),
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

function disabled() {
  return new ForbiddenError({ message: new Schedule.DisabledError().message })
}
