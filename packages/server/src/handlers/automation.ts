import { Automation } from "@opencode/core/automation"
import { Permission } from "@opencode/core/permission"
import { Project } from "@opencode/core/project"
import { Session } from "@opencode/core/session"
import { AbsolutePath } from "@opencode/core/schema"
import { AutomationNotFoundError, ForbiddenError, InvalidRequestError } from "@opencode/protocol/errors"
import type { CreatePayload, ListQuery } from "@opencode/protocol/groups/automation"
import { Effect } from "effect"
import path from "node:path"
import { HttpApiSchema } from "effect/http-api"
import { missingSession } from "./session-error"

/** `automation.*` in the `server.experimental` group. Every route needs experimental.automations where it runs. */
export const makeAutomation = Effect.gen(function* () {
  const automations = yield* Automation.Service
  const sessions = yield* Session.Service
  const projects = yield* Project.Service

  const enabled = (directory: string) =>
    automations.enabled(directory).pipe(
      // An automation whose folder is gone stays manageable, so it can be inspected and deleted.
      Effect.catchTag("FileSystem.DirectoryNotFoundError", () => Effect.succeed(true)),
    )
  const allowed = (directory: string) =>
    enabled(directory).pipe(Effect.flatMap((on) => (on ? Effect.void : Effect.fail(disabled()))))

  const find = (id: Automation.ID) =>
    Effect.gen(function* () {
      const info = yield* automations.get(id).pipe(Effect.mapError(missingAutomation))
      yield* allowed(info.directory)
      return info
    })

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
      Effect.gen(function* () {
        const session =
          query.sessionID === undefined
            ? undefined
            : yield* sessions.get(query.sessionID).pipe(Effect.mapError(missingSession))
        if (session !== undefined) yield* allowed(session.location.directory)
        const directory = query.directory
        if (directory !== undefined && !path.isAbsolute(directory))
          return yield* new InvalidRequestError({
            message: `Directory must be an absolute path: ${directory}`,
            kind: "automation",
          })
        if (directory !== undefined) yield* allowed(directory)
        // Reading ownership must not record a Project for a folder that was only asked about.
        const projectID =
          directory === undefined
            ? undefined
            : (yield* projects.resolve(AbsolutePath.make(directory), { persist: false })).id
        const rows = yield* automations.list({ sessionID: query.sessionID })
        // A deleted folder may no longer resolve to its Project, so also match automations that ran there.
        const matching = rows.filter(
          (row) => directory === undefined || row.projectID === projectID || row.directory === directory,
        )
        // Each automation is shown only where the flag allows it, the same as `get`.
        const directories = new Set(matching.map((row) => row.directory))
        const visible = new Set(yield* Effect.filter(directories, enabled))
        return { data: matching.filter((row) => visible.has(row.directory)) }
      }),
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
