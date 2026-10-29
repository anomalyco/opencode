export * as Schedule from "./schedule.js"

import { Duration, Option, Schema } from "effect"
import { ascending } from "./identifier.js"
import { DateTimeUtcFromMillis, NonNegativeInt, PositiveInt, optional, statics } from "./schema.js"
import { SessionID } from "./session-id.js"

export const ID = Schema.String.check(Schema.isStartingWith("sch_")).pipe(
  Schema.brand("Schedule.ID"),
  Schema.annotate({ identifier: "Schedule.ID" }),
  statics((schema) => ({
    create: () => schema.make("sch_" + ascending()),
  })),
)
export type ID = typeof ID.Type

const decodeDuration = Schema.decodeUnknownOption(Schema.DurationFromString)

/** Milliseconds in a duration string, or `None` when it is not one. */
export const durationMillis = (value: string) => decodeDuration(value).pipe(Option.map(Duration.toMillis))

/** A duration such as "90 seconds", "5 minutes" or "2 hours". The service validates it, since clients cannot run a custom check. */
export const DurationString = Schema.String.annotate({
  identifier: "Schedule.Duration",
  description: 'A duration such as "90 seconds", "5 minutes" or "2 hours".',
})

const zone = {
  tz: Schema.String.pipe(optional).annotate({
    description: "IANA time zone. Defaults to the configured timezone, then the server's local zone.",
  }),
}

export const In = Schema.Struct({ type: Schema.tag("in"), in: DurationString, ...zone }).annotate({
  identifier: "Schedule.When.In",
})
/** An instant with an offset, or a wall-clock time in `tz`, e.g. "2026-10-27T09:00". */
export const At = Schema.Struct({ type: Schema.tag("at"), at: Schema.String, ...zone }).annotate({
  identifier: "Schedule.When.At",
})
export const Every = Schema.Struct({ type: Schema.tag("every"), every: DurationString, ...zone }).annotate({
  identifier: "Schedule.When.Every",
})
export const Cron = Schema.Struct({ type: Schema.tag("cron"), cron: Schema.String, ...zone }).annotate({
  identifier: "Schedule.When.Cron",
})

export const When = Schema.Union([In, At, Every, Cron]).pipe(
  Schema.toTaggedUnion("type"),
  Schema.annotate({ identifier: "Schedule.When" }),
)
export type When = typeof When.Type

/** Stops a repeating schedule at whichever limit comes first. */
export const Ends = Schema.Struct({
  after: DurationString.pipe(optional),
  at: Schema.String.pipe(optional),
  times: PositiveInt.pipe(optional),
}).annotate({ identifier: "Schedule.Ends" })
export type Ends = typeof Ends.Type

export const PromptAction = Schema.Struct({ type: Schema.tag("prompt"), prompt: Schema.String }).annotate({
  identifier: "Schedule.Action.Prompt",
})

export const Action = Schema.Union([PromptAction]).pipe(
  Schema.toTaggedUnion("type"),
  Schema.annotate({ identifier: "Schedule.Action" }),
)
export type Action = typeof Action.Type

export const Status = Schema.Literals(["active", "paused", "done"]).annotate({ identifier: "Schedule.Status" })
export type Status = typeof Status.Type

export const Outcome = Schema.Literals(["fired", "late", "skipped", "disabled", "failed"]).annotate({
  identifier: "Schedule.Outcome",
})
export type Outcome = typeof Outcome.Type

export const Info = Schema.Struct({
  id: ID,
  sessionID: SessionID.pipe(optional),
  name: Schema.String.pipe(optional),
  when: When,
  tz: Schema.String,
  action: Action,
  status: Status,
  nextDueAt: DateTimeUtcFromMillis.pipe(optional),
  endsAt: DateTimeUtcFromMillis.pipe(optional),
  remainingRuns: NonNegativeInt.pipe(optional),
  runCount: NonNegativeInt,
  lastFiredAt: DateTimeUtcFromMillis.pipe(optional),
  lastOutcome: Outcome.pipe(optional),
  time: Schema.Struct({ created: DateTimeUtcFromMillis, updated: DateTimeUtcFromMillis }),
}).annotate({ identifier: "Schedule.Info" })
export type Info = typeof Info.Type

export const CreateInput = Schema.Struct({
  sessionID: SessionID,
  name: Schema.String.pipe(optional),
  when: When,
  ends: Ends.pipe(optional),
  action: Action,
}).annotate({ identifier: "Schedule.CreateInput" })
export type CreateInput = typeof CreateInput.Type

/** Declares a trigger absent, so `{ in, every }` fails instead of decoding as a one-shot. */
const absent = Schema.optionalKey(Schema.Never)

/** The `when` callers write: exactly one of `in`, `at`, `every` or `cron`, with an optional `tz`. */
export const WhenInput = Schema.Union([
  Schema.Struct({ in: In.fields.in, at: absent, every: absent, cron: absent, ...zone }),
  Schema.Struct({ at: At.fields.at, in: absent, every: absent, cron: absent, ...zone }),
  Schema.Struct({ every: Every.fields.every, in: absent, at: absent, cron: absent, ...zone }),
  Schema.Struct({ cron: Cron.fields.cron, in: absent, at: absent, every: absent, ...zone }),
]).annotate({ identifier: "Schedule.WhenInput" })
export type WhenInput = typeof WhenInput.Type

/** A schedule as callers describe it: when it fires, when it stops, and the prompt it wakes the Session with. */
export const Request = Schema.Struct({
  name: Schema.String.pipe(optional).annotate({ description: "A short label for the schedule." }),
  when: WhenInput.annotate({
    description:
      'When it fires: { in: "20 minutes" }, { at: "2026-10-27T09:00" }, { every: "1 hour" } or { cron: "0 9 * * 1-5" }. Wall-clock times use tz.',
  }),
  ends: Ends.pipe(optional).annotate({
    description: 'Stops a repeating schedule at the first limit reached: { after: "8 hours" }, { at }, { times: 3 }.',
  }),
  prompt: Schema.String.check(Schema.isMinLength(1)).annotate({
    description: "The message the Session receives each time the schedule fires.",
  }),
}).annotate({ identifier: "Schedule.Request" })
export type Request = typeof Request.Type

export const toCreateInput = (sessionID: SessionID, request: Request): CreateInput => ({
  sessionID,
  name: request.name,
  when: toWhen(request.when),
  ends: request.ends,
  action: { type: "prompt", prompt: request.prompt },
})

const toWhen = (when: WhenInput): When => {
  if (when.in !== undefined) return { type: "in", in: when.in, tz: when.tz }
  if (when.at !== undefined) return { type: "at", at: when.at, tz: when.tz }
  if (when.every !== undefined) return { type: "every", every: when.every, tz: when.tz }
  return { type: "cron", cron: when.cron, tz: when.tz }
}
