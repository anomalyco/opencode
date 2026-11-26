import { Automation } from "@opencode/core/automation"
import { Permission } from "@opencode/core/permission"
import { AutomationNotFoundError, ForbiddenError, InvalidRequestError } from "@opencode/protocol/errors"
import type { CreatePayload, ListQuery } from "@opencode/protocol/groups/automation"
import { Effect } from "effect"
import { HttpApiSchema } from "effect/http-api"
import { missingSession } from "./session-error"

/** `automation.*` in the `server.experimental` group. Every route requires automations to be enabled where it runs. */
export const makeAutomation = Effect.gen(function* () {
  const automations = yield* Automation.Service

  return {
    create: (payload: CreatePayload) =>
      // Stateless HTTP callers have no guaranteed UI listener to answer an interactive ask, so settle asks unattended.
      automations.create(payload).pipe(
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
    list: (query: ListQuery) =>
      automations.list(query).pipe(
        Effect.map((data) => ({ data })),
        Effect.catchTags({
          "Automation.InvalidError": (error) =>
            Effect.fail(new InvalidRequestError({ message: error.message, kind: "automation" })),
          "Automation.DisabledError": () => Effect.fail(disabled()),
          "Session.NotFoundError": (error) => Effect.fail(missingSession(error)),
        }),
      ),
    get: (id: Automation.ID) => managed(automations.get(id).pipe(Effect.map((data) => ({ data })))),
    pause: (id: Automation.ID) => managed(automations.pause(id).pipe(Effect.map((data) => ({ data })))),
    resume: (id: Automation.ID) => managed(automations.resume(id).pipe(Effect.map((data) => ({ data })))),
    remove: (id: Automation.ID) => managed(automations.remove(id).pipe(Effect.as(HttpApiSchema.NoContent.make()))),
  }
})

function managed<A>(effect: Effect.Effect<A, Automation.NotFoundError | Automation.DisabledError>) {
  return effect.pipe(
    Effect.catchTags({
      "Automation.NotFoundError": (error) => Effect.fail(missingAutomation(error)),
      "Automation.DisabledError": () => Effect.fail(disabled()),
    }),
  )
}

function missingAutomation(error: { readonly automationID: Automation.ID }) {
  return new AutomationNotFoundError({
    automationID: error.automationID,
    message: `Automation not found: ${error.automationID}`,
  })
}

function disabled() {
  return new ForbiddenError({ message: new Automation.DisabledError().message })
}
