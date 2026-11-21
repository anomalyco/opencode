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

export const CreatePayload = Automation.CreateInput.annotate({ identifier: "Automation.CreatePayload" })
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
      "Create an automation that sends a prompt, runs a Code Mode program, or runs a shell command at a time, every interval, or on a cron. Creating an MCP event watch requires the automation_create tool in a local session; a session ID over HTTP is not a watch authorization.",
    ),
  ),
  HttpApiEndpoint.get("automation.list", "/api/experimental/automation", {
    query: ListQuery,
    success: Schema.Struct({ data: Schema.Array(Automation.Info) }),
    error: [SessionNotFoundError, ForbiddenError, InvalidRequestError],
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
      "Resume a paused automation. A missed `at` runs once; repeating timers resume at their next slot. Event watches request replay from their saved cursor.",
    ),
  ),
  HttpApiEndpoint.delete("automation.delete", "/api/experimental/automation/:automationID", {
    params,
    success: HttpApiSchema.NoContent,
    error: errors,
  }).annotateMerge(annotations("delete", "Delete automation", "Delete an automation.")),
] as const
