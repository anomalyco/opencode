import { Automation } from "@opencode/schema/automation"
import { Session } from "@opencode/schema/session"
import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiSchema, OpenApi } from "effect/http-api"
import { AutomationNotFoundError, ForbiddenError, InvalidRequestError, SessionNotFoundError } from "../errors.js"

const EXPERIMENTAL =
  "Experimental: needs experimental.automations in the Session's config and may change without notice."
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

export const CreatePayload = Schema.Struct({ sessionID: Session.ID, ...Automation.Request.fields }).annotate({
  identifier: "Automation.CreatePayload",
})
export type CreatePayload = typeof CreatePayload.Type

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
      "Create an automation that wakes the Session once after a delay, at a time, every interval, on a cron, or on a check.",
    ),
  ),
  HttpApiEndpoint.get("automation.list", "/api/experimental/automation", {
    query: { sessionID: Schema.optional(Session.ID) },
    success: Schema.Struct({ data: Schema.Array(Automation.Info) }),
    error: [SessionNotFoundError, ForbiddenError],
  }).annotateMerge(
    annotations(
      "list",
      "List automations",
      "List automations for a Session, or across all enabled Sessions when sessionID is omitted, oldest first.",
    ),
  ),
  HttpApiEndpoint.get("automation.get", "/api/experimental/automation/:automationID", {
    params,
    success: Schema.Struct({ data: Automation.Info }),
    error: errors,
  }).annotateMerge(annotations("get", "Get automation", "Read one automation.")),
  HttpApiEndpoint.post("automation.pause", "/api/experimental/automation/:automationID/pause", {
    params,
    success: Schema.Struct({ data: Automation.Info }),
    error: errors,
  }).annotateMerge(annotations("pause", "Pause automation", "Stop an automation from firing until it is resumed.")),
  HttpApiEndpoint.post("automation.resume", "/api/experimental/automation/:automationID/resume", {
    params,
    success: Schema.Struct({ data: Automation.Info }),
    error: errors,
  }).annotateMerge(
    annotations(
      "resume",
      "Resume automation",
      "Resume a paused automation. A one-shot that fell due while paused fires once; a repeating automation resumes at its next slot.",
    ),
  ),
  HttpApiEndpoint.delete("automation.delete", "/api/experimental/automation/:automationID", {
    params,
    success: HttpApiSchema.NoContent,
    error: errors,
  }).annotateMerge(annotations("delete", "Delete automation", "Delete an automation.")),
] as const
