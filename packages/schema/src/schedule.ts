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

/**
 * Runs `run` in the Session's directory before firing, with no model call. With none of `is`, `matches` or `changes`
 * set, exit 0 wakes and any non-zero exit is "not yet". With `is`, `matches` or `changes`, non-zero exit is a check
 * error, and exit 0 wakes when trimmed stdout equals `is`, stdout matches `matches`, or stdout differs from the
 * previous run (`changes`).
 */
export const ShellCondition = Schema.Struct({
  type: Schema.tag("shell"),
  run: Schema.String,
  is: Schema.String.pipe(optional),
  matches: Schema.String.pipe(optional),
  changes: Schema.Boolean.pipe(optional),
}).annotate({ identifier: "Schedule.Condition.Shell" })
export type ShellCondition = typeof ShellCondition.Type

/**
 * Runs `code` in a confined Code Mode runtime before firing, with no model call and no `fetch`. Tools called statically
 * as `tools.<path>(...)` are extracted from the AST and authorized at creation; the program receives `state` (initially
 * `null`), `now` (epoch ms) and `runs` (completed checks), and returns a boolean or `{ wake, state?, message? }`.
 */
export const CodeCondition = Schema.Struct({
  type: Schema.tag("code"),
  code: Schema.String,
}).annotate({ identifier: "Schedule.Condition.Code" })
export type CodeCondition = typeof CodeCondition.Type

/** Checked before firing; the schedule wakes the Session only when the condition passes. */
export const Condition = Schema.Union([ShellCondition, CodeCondition]).pipe(
  Schema.toTaggedUnion("type"),
  Schema.annotate({ identifier: "Schedule.Condition" }),
)
export type Condition = typeof Condition.Type

export const CheckMode = Schema.Literals(["if", "until"]).annotate({ identifier: "Schedule.CheckMode" })
export type CheckMode = typeof CheckMode.Type

export const StoredCheck = Schema.Struct({
  mode: CheckMode,
  condition: Condition,
}).annotate({ identifier: "Schedule.StoredCheck" })
export type StoredCheck = typeof StoredCheck.Type

export const Status = Schema.Literals(["active", "paused", "done"]).annotate({ identifier: "Schedule.Status" })
export type Status = typeof Status.Type

export const Outcome = Schema.Literals([
  "fired",
  "late",
  "checked",
  "expired",
  "skipped",
  "disabled",
  "failed",
]).annotate({
  identifier: "Schedule.Outcome",
})
export type Outcome = typeof Outcome.Type

export const Info = Schema.Struct({
  id: ID,
  sessionID: SessionID.pipe(optional),
  name: Schema.String.pipe(optional),
  when: When,
  tz: Schema.String,
  if: Condition.pipe(optional),
  until: Condition.pipe(optional),
  action: Action,
  status: Status,
  nextDueAt: DateTimeUtcFromMillis.pipe(optional),
  endsAt: DateTimeUtcFromMillis.pipe(optional),
  remainingRuns: NonNegativeInt.pipe(optional),
  runCount: NonNegativeInt,
  lastFiredAt: DateTimeUtcFromMillis.pipe(optional),
  lastOutcome: Outcome.pipe(optional),
  lastOutput: Schema.String.pipe(optional),
  time: Schema.Struct({ created: DateTimeUtcFromMillis, updated: DateTimeUtcFromMillis }),
}).annotate({ identifier: "Schedule.Info" })
export type Info = typeof Info.Type

export const CreateInput = Schema.Struct({
  sessionID: SessionID,
  name: Schema.String.pipe(optional),
  when: When.pipe(optional),
  if: Condition.pipe(optional),
  until: Condition.pipe(optional),
  ends: Ends.pipe(optional),
  action: Action,
}).annotate({ identifier: "Schedule.CreateInput" })
export type CreateInput = typeof CreateInput.Type

/** Declares a variant field absent, so `{ in, every }` or `{ run, code }` fails instead of silently dropping one. */
const absent = Schema.optionalKey(Schema.Never)

/** The `when` callers write: exactly one of `in`, `at`, `every` or `cron`, with an optional `tz`. */
export const WhenInput = Schema.Union([
  Schema.Struct({ in: In.fields.in, at: absent, every: absent, cron: absent, ...zone }),
  Schema.Struct({ at: At.fields.at, in: absent, every: absent, cron: absent, ...zone }),
  Schema.Struct({ every: Every.fields.every, in: absent, at: absent, cron: absent, ...zone }),
  Schema.Struct({ cron: Cron.fields.cron, in: absent, at: absent, every: absent, ...zone }),
]).annotate({ identifier: "Schedule.WhenInput" })
export type WhenInput = typeof WhenInput.Type

export const ShellConditionInput = Schema.Struct({
  run: Schema.String.check(Schema.isMinLength(1)).annotate({
    description: "Shell command to run in the Session's directory. Alone, exit 0 wakes and stdout is appended.",
  }),
  is: Schema.String.pipe(optional).annotate({
    description: "Wake when exit is 0 and trimmed stdout equals this value.",
  }),
  matches: Schema.String.pipe(optional).annotate({
    description: "Wake when exit is 0 and stdout matches this regular expression.",
  }),
  changes: Schema.Boolean.pipe(optional).annotate({
    description: "Wake when exit is 0 and stdout differs from the previous check.",
  }),
}).annotate({ identifier: "Schedule.ShellConditionInput" })

export const CodeConditionInput = Schema.Struct({
  code: Schema.String.check(Schema.isMinLength(1)).annotate({
    description: [
      "Code Mode JavaScript check (no fetch; 30s, 20 tool calls, 32 KB output cap).",
      'Call tools statically as tools.<ns>.<tool>(...) or tools["ns-name"].tool(...); each is authorized once at creation to run unattended.',
      "Runs once at creation with state = null (if baselines state without waking; until matches immediately if true), with globals state, now (epoch ms) and runs.",
      "Return a boolean or { wake, state?, message? } (message is appended to prompt on wake), e.g.:",
      'const t = await tools.slack.read_thread({ id }); return { wake: state !== null && t.count > state.count, state: { count: t.count }, message: "New reply" }',
    ].join(" "),
  }),
}).annotate({ identifier: "Schedule.CodeConditionInput" })

export const ConditionInput = Schema.Union([
  Schema.Struct({ ...ShellConditionInput.fields, code: absent }),
  Schema.Struct({
    ...CodeConditionInput.fields,
    run: absent,
    is: absent,
    matches: absent,
    changes: absent,
  }),
]).annotate({ identifier: "Schedule.ConditionInput" })
export type ConditionInput = typeof ConditionInput.Type

/** A schedule as callers describe it: when it fires, optional condition, when it stops, and the prompt it sends. */
export const Request = Schema.Struct({
  name: Schema.String.pipe(optional).annotate({ description: "A short label for the schedule." }),
  when: WhenInput.pipe(optional).annotate({
    description:
      'When it fires: { in: "20 minutes" }, { at: "2026-10-27T09:00" }, { every: "1 hour" } or { cron: "0 9 * * 1-5" }. Optional with `until` (defaults to { every: "30 seconds" }).',
  }),
  if: ConditionInput.pipe(optional).annotate({
    description:
      "Recurring gate ({ run } shell command or { code } Code Mode script): check on each slot with no model call, and wake on every slot where it passes.",
  }),
  until: ConditionInput.pipe(optional).annotate({
    description:
      'One-shot gate ({ run } shell command or { code } Code Mode script): poll with no model call, wake once when it passes, and stop. Defaults ends.after to "24 hours".',
  }),
  ends: Ends.pipe(optional).annotate({
    description: 'Stops a repeating schedule at the first limit reached: { after: "8 hours" }, { at }, { times: 3 }.',
  }),
  prompt: Schema.String.check(Schema.isMinLength(1)).annotate({
    description: "The message the Session receives when the schedule wakes.",
  }),
}).annotate({ identifier: "Schedule.Request" })
export type Request = typeof Request.Type

export const toCreateInput = (sessionID: SessionID, request: Request): CreateInput => ({
  sessionID,
  name: request.name,
  when: request.when === undefined ? undefined : toWhen(request.when),
  if: request.if === undefined ? undefined : toCondition(request.if),
  until: request.until === undefined ? undefined : toCondition(request.until),
  ends: request.ends,
  action: { type: "prompt", prompt: request.prompt },
})

const toCondition = (condition: ConditionInput): Condition => {
  if (condition.code !== undefined) return { type: "code", code: condition.code }
  return {
    type: "shell",
    run: condition.run,
    is: condition.is,
    matches: condition.matches,
    changes: condition.changes,
  }
}

const toWhen = (when: WhenInput): When => {
  if (when.in !== undefined) return { type: "in", in: when.in, tz: when.tz }
  if (when.at !== undefined) return { type: "at", at: when.at, tz: when.tz }
  if (when.every !== undefined) return { type: "every", every: when.every, tz: when.tz }
  return { type: "cron", cron: when.cron, tz: when.tz }
}
