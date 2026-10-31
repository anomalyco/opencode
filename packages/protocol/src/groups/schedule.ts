import { Schedule } from "@opencode/schema/schedule"
import { PositiveInt } from "@opencode/schema/schema"
import { Session } from "@opencode/schema/session"
import { Schema, SchemaGetter } from "effect"
import { HttpApiEndpoint, HttpApiSchema, OpenApi } from "effect/http-api"
import {
  ForbiddenError,
  InvalidRequestError,
  ScheduleNotFoundError,
  ScheduleRunNotFoundError,
  SessionNotFoundError,
} from "../errors.js"

const EXPERIMENTAL = "Experimental: needs experimental.schedules in the Session's config and may change without notice."
const errors = [ScheduleNotFoundError, ForbiddenError] as const
const params = { scheduleID: Schedule.ID }
const BooleanFromString = Schema.Literals(["true", "false"]).pipe(
  Schema.decodeTo(Schema.Boolean, {
    decode: SchemaGetter.transform((value) => value === "true"),
    encode: SchemaGetter.transform((value): "true" | "false" => (value ? "true" : "false")),
  }),
)
const LimitFromString = Schema.NumberFromString.pipe(Schema.decodeTo(PositiveInt), Schema.optional)
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

export const InboxQuery = Schema.Struct({
  sessionID: Session.ID.pipe(Schema.optional),
  includeRead: BooleanFromString.pipe(Schema.optional),
  limit: LimitFromString,
}).annotate({ identifier: "Schedule.InboxQuery" })
export type InboxQuery = typeof InboxQuery.Type

export const RunsQuery = Schema.Struct({
  limit: LimitFromString,
}).annotate({ identifier: "Schedule.RunsQuery" })
export type RunsQuery = typeof RunsQuery.Type

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
      "Schedule a prompt, subagent, slash command, shell command, or Code Mode script to run once after a delay, at a time, every interval, or on a cron.",
    ),
  ),
  HttpApiEndpoint.get("schedule.list", "/api/experimental/schedule", {
    query: { sessionID: Session.ID },
    success: Schema.Struct({ data: Schema.Array(Schedule.Info) }),
    error: [SessionNotFoundError, ForbiddenError],
  }).annotateMerge(annotations("list", "List schedules", "List a Session's schedules, oldest first.")),
  HttpApiEndpoint.get("schedule.inbox", "/api/experimental/schedule/inbox", {
    query: InboxQuery,
    success: Schema.Struct({ data: Schema.Array(Schedule.Run) }),
    error: [SessionNotFoundError, ForbiddenError],
  }).annotateMerge(
    annotations(
      "inbox",
      "List schedule inbox",
      "List scheduled run items needing attention (`needs_you` first, then `ready`). When `sessionID` is omitted, returns items across all Sessions with schedules enabled.",
    ),
  ),
  HttpApiEndpoint.post("schedule.markRead", "/api/experimental/schedule/runs/:runID/read", {
    params: { runID: Schedule.RunID },
    success: Schema.Struct({ data: Schedule.Run }),
    error: [ScheduleRunNotFoundError, ForbiddenError],
  }).annotateMerge(annotations("markRead", "Mark schedule run read", "Mark a scheduled run item as read in the Inbox.")),
  HttpApiEndpoint.get("schedule.get", "/api/experimental/schedule/:scheduleID", {
    params,
    success: Schema.Struct({ data: Schedule.Info }),
    error: errors,
  }).annotateMerge(annotations("get", "Get schedule", "Read one schedule.")),
  HttpApiEndpoint.get("schedule.runs", "/api/experimental/schedule/:scheduleID/runs", {
    params,
    query: RunsQuery,
    success: Schema.Struct({ data: Schema.Array(Schedule.Run) }),
    error: errors,
  }).annotateMerge(annotations("runs", "List schedule runs", "List recent run history for a schedule, newest first.")),
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
