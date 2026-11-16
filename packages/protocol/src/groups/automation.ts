import { Automation } from "@opencode/schema/automation"
import { Session } from "@opencode/schema/session"
import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiSchema, OpenApi } from "effect/http-api"
import { AutomationNotFoundError, ForbiddenError, InvalidRequestError, SessionNotFoundError } from "../errors.js"

const EXPERIMENTAL =
  "Experimental: needs experimental.automations in the config of the automation's directory and may change without compatibility guarantees."
const errors = [AutomationNotFoundError, ForbiddenError] as const
const params = { automationID: Automation.ID }
const annotations = (identifier: string, summary: string, description: string) =>
  OpenApi.annotations({
    identifier: `experimental.automation.${identifier}`,
    summary,
    description: `${description} ${EXPERIMENTAL}`,
    // The routes share the `server.experimental` group with the persistent PTY prototype; tag them on their own.
    transform: (operation) => ({ ...operation, tags: ["experimental"] }),
  })

export const CreatePayload = Schema.Struct({
  sessionID: Session.ID.pipe(Schema.optional).annotate({
    description:
      "The Session creating it, if any. It supplies the directory, the default prompt target and, for a code action, the agent and permissions its tools run with.",
  }),
  directory: Schema.String.pipe(Schema.optional).annotate({
    description: "Where it runs when there is no Session. Defaults to the server user's home folder.",
  }),
  ...Automation.Request.fields,
}).annotate({ identifier: "Automation.CreatePayload" })
export type CreatePayload = typeof CreatePayload.Type

export const ListQuery = Schema.Struct({
  sessionID: Session.ID.pipe(Schema.optional).annotate({ description: "Only automations created by this Session." }),
  directory: Schema.String.pipe(Schema.optional).annotate({
    description: "Only automations in the project that owns this directory.",
  }),
}).annotate({ identifier: "Automation.ListQuery" })
export type ListQuery = typeof ListQuery.Type

/** Lives in the `server.experimental` group (see `groups/experimental.ts`). */
export const AutomationEndpoints = [
  HttpApiEndpoint.post("automation.create", "/api/experimental/automation", {
    payload: CreatePayload,
    success: Schema.Struct({ data: Automation.Info }),
    error: [InvalidRequestError, SessionNotFoundError, ForbiddenError],
  }).annotateMerge(
    annotations(
      "create",
      "Create automation",
      "Create an automation that sends a prompt or runs a Code Mode program at a time, every interval, or on a cron.",
    ),
  ),
  HttpApiEndpoint.get("automation.list", "/api/experimental/automation", {
    query: ListQuery,
    success: Schema.Struct({ data: Schema.Array(Automation.Info) }),
    error: [SessionNotFoundError, ForbiddenError],
  }).annotateMerge(annotations("list", "List automations", "List automations, oldest first.")),
  HttpApiEndpoint.get("automation.get", "/api/experimental/automation/:automationID", {
    params,
    success: Schema.Struct({ data: Automation.Info }),
    error: errors,
  }).annotateMerge(annotations("get", "Get automation", "Read one automation.")),
  HttpApiEndpoint.post("automation.pause", "/api/experimental/automation/:automationID/pause", {
    params,
    success: Schema.Struct({ data: Automation.Info }),
    error: errors,
  }).annotateMerge(annotations("pause", "Pause automation", "Stop an automation from running until it is resumed.")),
  HttpApiEndpoint.post("automation.resume", "/api/experimental/automation/:automationID/resume", {
    params,
    success: Schema.Struct({ data: Automation.Info }),
    error: errors,
  }).annotateMerge(
    annotations(
      "resume",
      "Resume automation",
      "Resume a paused automation. An `at` automation that fell due while paused runs once; a repeating one resumes at its next slot.",
    ),
  ),
  HttpApiEndpoint.delete("automation.delete", "/api/experimental/automation/:automationID", {
    params,
    success: HttpApiSchema.NoContent,
    error: errors,
  }).annotateMerge(annotations("delete", "Delete automation", "Delete an automation.")),
] as const
