import { Schedule } from "@opencode/schema/schedule"
import { Session } from "@opencode/schema/session"
import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiSchema, OpenApi } from "effect/http-api"
import { ForbiddenError, InvalidRequestError, ScheduleNotFoundError, SessionNotFoundError } from "../errors.js"

const EXPERIMENTAL = "Experimental: needs experimental.schedules in the Session's config and may change without notice."
const errors = [ScheduleNotFoundError, ForbiddenError] as const
const params = { scheduleID: Schedule.ID }
const annotations = (identifier: string, summary: string, description: string) =>
  OpenApi.annotations({
    identifier: `experimental.schedule.${identifier}`,
    summary,
    description: `${description} ${EXPERIMENTAL}`,
    // The routes share the `server.experimental` group with the persistent PTY prototype; tag them on their own.
    transform: (operation) => ({ ...operation, tags: ["experimental"] }),
  })

export const CreatePayload = Schema.Struct({ sessionID: Session.ID, ...Schedule.Request.fields }).annotate({
  identifier: "Schedule.CreatePayload",
})
export type CreatePayload = typeof CreatePayload.Type

/** Lives in the `server.experimental` group (see `groups/experimental.ts`). */
export const ScheduleEndpoints = [
  HttpApiEndpoint.post("schedule.create", "/api/experimental/schedule", {
    payload: CreatePayload,
    success: Schema.Struct({ data: Schedule.Info }),
    error: [InvalidRequestError, SessionNotFoundError, ForbiddenError],
  }).annotateMerge(
    annotations(
      "create",
      "Create schedule",
      "Schedule a prompt that wakes the Session once after a delay, at a time, every interval, or on a cron.",
    ),
  ),
  HttpApiEndpoint.get("schedule.list", "/api/experimental/schedule", {
    query: { sessionID: Session.ID },
    success: Schema.Struct({ data: Schema.Array(Schedule.Info) }),
    error: [SessionNotFoundError, ForbiddenError],
  }).annotateMerge(annotations("list", "List schedules", "List a Session's schedules, oldest first.")),
  HttpApiEndpoint.get("schedule.get", "/api/experimental/schedule/:scheduleID", {
    params,
    success: Schema.Struct({ data: Schedule.Info }),
    error: errors,
  }).annotateMerge(annotations("get", "Get schedule", "Read one schedule.")),
  HttpApiEndpoint.post("schedule.pause", "/api/experimental/schedule/:scheduleID/pause", {
    params,
    success: Schema.Struct({ data: Schedule.Info }),
    error: errors,
  }).annotateMerge(annotations("pause", "Pause schedule", "Stop a schedule from firing until it is resumed.")),
  HttpApiEndpoint.post("schedule.resume", "/api/experimental/schedule/:scheduleID/resume", {
    params,
    success: Schema.Struct({ data: Schedule.Info }),
    error: errors,
  }).annotateMerge(
    annotations(
      "resume",
      "Resume schedule",
      "Resume a paused schedule. A one-shot that fell due while paused fires once; a repeating schedule resumes at its next slot.",
    ),
  ),
  HttpApiEndpoint.delete("schedule.delete", "/api/experimental/schedule/:scheduleID", {
    params,
    success: HttpApiSchema.NoContent,
    error: errors,
  }).annotateMerge(annotations("delete", "Delete schedule", "Delete a schedule.")),
] as const
