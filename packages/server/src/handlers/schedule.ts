import { Schedule } from "@opencode/core/schedule"
import type { Session } from "@opencode/core/session"
import { ForbiddenError, InvalidRequestError, ScheduleNotFoundError } from "@opencode/protocol/errors"
import type { CreatePayload } from "@opencode/protocol/groups/schedule"
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
      schedules.create(Schedule.toCreateInput(payload.sessionID, payload)).pipe(
        Effect.map((data) => ({ data })),
        Effect.catchTags({
          "Schedule.InvalidError": (error) =>
            Effect.fail(new InvalidRequestError({ message: error.message, kind: "schedule" })),
          "Schedule.DisabledError": () => Effect.fail(disabled()),
          "Session.NotFoundError": (error) => Effect.fail(missingSession(error)),
        }),
      ),
    list: (sessionID: Session.ID) =>
      allowed(sessionID).pipe(
        Effect.andThen(schedules.list({ sessionID })),
        Effect.map((data) => ({ data })),
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
