import { Automation } from "@opencode/core/automation"
import { Permission } from "@opencode/core/permission"
import type { Session } from "@opencode/core/session"
import { AutomationNotFoundError, ForbiddenError, InvalidRequestError } from "@opencode/protocol/errors"
import type { CreatePayload } from "@opencode/protocol/groups/automation"
import { Effect } from "effect"
import { HttpApiSchema } from "effect/http-api"
import { missingSession } from "./session-error"

/** `automation.*` in the `server.experimental` group. Every route honors experimental.automations where the Session lives. */
export const makeAutomation = Effect.gen(function* () {
  const automations = yield* Automation.Service

  const allowed = (sessionID: Session.ID) =>
    automations.enabled(sessionID).pipe(
      Effect.mapError(missingSession),
      Effect.flatMap((enabled) => (enabled ? Effect.void : Effect.fail(disabled()))),
    )

  // An automation whose Session is gone, or whose location has the flag off, reads as missing or forbidden like the rest.
  const find = (id: Automation.ID) =>
    Effect.gen(function* () {
      const info = yield* automations.get(id).pipe(Effect.mapError(missingAutomation))
      if (info.sessionID === undefined) return yield* missingAutomation({ automationID: id })
      yield* allowed(info.sessionID).pipe(
        Effect.catchTag("SessionNotFoundError", () => Effect.fail(missingAutomation({ automationID: id }))),
      )
      return info
    })

  return {
    create: (payload: CreatePayload) =>
      // Stateless HTTP callers have no guaranteed UI listener to answer an interactive ask, so settle asks unattended.
      automations.create(Automation.toCreateInput(payload.sessionID, payload)).pipe(
        Effect.provideService(Permission.Unattended, []),
        Effect.map((data) => ({ data })),
        Effect.catchTags({
          "Automation.InvalidError": (error) =>
            Effect.fail(new InvalidRequestError({ message: error.message, kind: "automation" })),
          "Automation.DisabledError": () => Effect.fail(disabled()),
          "Permission.BlockedError": (error) => Effect.fail(new ForbiddenError({ message: error.message })),
          "Permission.CorrectedError": (error) => Effect.fail(new ForbiddenError({ message: error.feedback })),
          "Session.NotFoundError": (error) => Effect.fail(missingSession(error)),
        }),
      ),
    list: (sessionID: Session.ID | undefined) =>
      sessionID !== undefined
        ? allowed(sessionID).pipe(
            Effect.andThen(automations.list({ sessionID })),
            Effect.map((data) => ({ data })),
          )
        : automations.list().pipe(
            Effect.flatMap((rows) => {
              const cache = new Map<Session.ID, boolean>()
              return Effect.filter(rows, (row) => {
                const sid = row.sessionID
                if (sid === undefined) return Effect.succeed(false)
                const cached = cache.get(sid)
                if (cached !== undefined) return Effect.succeed(cached)
                return automations.enabled(sid).pipe(
                  Effect.tap((on) => Effect.sync(() => cache.set(sid, on))),
                  Effect.orElseSucceed(() => {
                    cache.set(sid, false)
                    return false
                  }),
                )
              })
            }),
            Effect.map((data) => ({ data })),
          ),
    get: (id: Automation.ID) => find(id).pipe(Effect.map((data) => ({ data }))),
    pause: (id: Automation.ID) =>
      find(id).pipe(
        Effect.andThen(automations.pause(id).pipe(Effect.mapError(missingAutomation))),
        Effect.map((data) => ({ data })),
      ),
    resume: (id: Automation.ID) =>
      find(id).pipe(
        Effect.andThen(automations.resume(id).pipe(Effect.mapError(missingAutomation))),
        Effect.map((data) => ({ data })),
      ),
    remove: (id: Automation.ID) =>
      find(id).pipe(
        Effect.andThen(automations.remove(id).pipe(Effect.mapError(missingAutomation))),
        Effect.as(HttpApiSchema.NoContent.make()),
      ),
  }
})

function missingAutomation(error: { readonly automationID: Automation.ID }) {
  return new AutomationNotFoundError({
    automationID: error.automationID,
    message: `Automation not found: ${error.automationID}`,
  })
}

function disabled() {
  return new ForbiddenError({ message: new Automation.DisabledError().message })
}
