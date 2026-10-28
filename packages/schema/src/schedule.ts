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

/** A duration such as "90 seconds", "5 minutes" or "2 hours". */
export const DurationString = Schema.String.check(
  Schema.makeFilter((value: string) =>
    Option.match(durationMillis(value), {
      onNone: () => `expected a duration such as "5 minutes", got ${JSON.stringify(value)}`,
      onSome: (millis) => millis > 0 || "expected a positive duration",
    }),
  ),
).annotate({ identifier: "Schedule.Duration" })

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
