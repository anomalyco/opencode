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

export const SessionTarget = Schema.Union([
  Schema.Struct({
    type: Schema.tag("session"),
  }).annotate({
    identifier: "Schedule.Target.Session",
  }),
  Schema.Struct({
    type: Schema.tag("subagent"),
    agent: Schema.String.pipe(optional).annotate({
      description: 'Optional subagent name (defaults to the command\'s configured agent, then "general").',
    }),
    notify: Schema.Boolean.pipe(optional).annotate({
      description: "Whether non-quiet completion output posts a notice to this session (defaults to true).",
    }),
  }).annotate({
    identifier: "Schedule.Target.Subagent",
  }),
]).pipe(
  Schema.toTaggedUnion("type"),
  Schema.annotate({ identifier: "Schedule.SessionTarget" }),
)
export type SessionTarget = typeof SessionTarget.Type

export const PromptAction = Schema.Struct({
  type: Schema.tag("prompt"),
  prompt: Schema.String.annotate({
    description: 'Instruction for a model turn. Reply "NO_REPLY" in a subagent to finish quietly.',
  }),
  target: SessionTarget.pipe(optional).annotate({
    description:
      'Where the prompt runs: { type: "session" } (default, this session) or { type: "subagent", agent?, notify? }.',
  }),
}).annotate({
  identifier: "Schedule.Action.Prompt",
})
export type PromptAction = typeof PromptAction.Type

export const CommandAction = Schema.Struct({
  type: Schema.tag("command"),
  name: Schema.String.annotate({
    description: 'Slash command name (without leading `/`, e.g. "morning-brief").',
  }),
  arguments: Schema.String.pipe(optional).annotate({
    description: "Optional arguments passed to the slash command.",
  }),
  target: SessionTarget.pipe(optional).annotate({
    description:
      'Where the command runs: { type: "session" } (default, this session) or { type: "subagent", agent?, notify? }.',
  }),
}).annotate({
  identifier: "Schedule.Action.Command",
})
export type CommandAction = typeof CommandAction.Type

export const ShellAction = Schema.Struct({
  type: Schema.tag("shell"),
  run: Schema.String.annotate({
    description: "Deterministic shell command executed in the Session's directory with no model call.",
  }),
  notify: Schema.Boolean.pipe(optional).annotate({
    description: "Whether non-empty stdout posts a notice to this session (defaults to true).",
  }),
}).annotate({
  identifier: "Schedule.Action.Shell",
})
export type ShellAction = typeof ShellAction.Type

export const CodeAction = Schema.Struct({
  type: Schema.tag("code"),
  code: Schema.String.annotate({
    description:
      "Deterministic Code Mode JavaScript script executed with no model call (no fetch; static tools.<ns>.<tool> calls authorized once at creation).",
  }),
  notify: Schema.Boolean.pipe(optional).annotate({
    description: "Whether non-empty output posts a notice to this session (defaults to true).",
  }),
}).annotate({
  identifier: "Schedule.Action.Code",
})
export type CodeAction = typeof CodeAction.Type

export const Action = Schema.Union([PromptAction, CommandAction, ShellAction, CodeAction]).pipe(
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
  run: Schema.String.annotate({
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
}).annotate({ identifier: "Schedule.Condition.Shell" })
export type ShellCondition = typeof ShellCondition.Type

/**
 * Runs `code` in a confined Code Mode runtime before firing, with no model call and no `fetch`. Tools called statically
 * as `tools.<path>(...)` are extracted from the AST and authorized at creation; the program receives `state` (initially
 * `null`), `now` (epoch ms) and `runs` (completed checks), and returns a boolean or `{ wake, state?, message? }`.
 */
export const CodeCondition = Schema.Struct({
  type: Schema.tag("code"),
  code: Schema.String.annotate({
    description: [
      "Code Mode JavaScript check (no fetch; 30s, 20 tool calls, 32 KB output cap).",
      'Call tools statically as tools.<ns>.<tool>(...) or tools["ns-name"].tool(...); each is authorized once at creation to run unattended.',
      "Runs once at creation with state = null (if baselines state without waking; until matches immediately if true), with globals state, now (epoch ms) and runs.",
      "Return a boolean or { wake, state?, message? } (message is appended to prompt on wake).",
    ].join(" "),
  }),
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
  activeJobID: Schema.String.pipe(optional),
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

/** A schedule as callers describe it: when it fires, optional condition, when it stops, and the action it runs. */
export const Request = Schema.Struct({
  name: Schema.String.pipe(optional).annotate({ description: "A short label for the schedule." }),
  when: When.pipe(optional).annotate({
    description:
      'When it fires: { type: "in", in: "20 minutes" }, { type: "at", at: "2026-10-27T09:00" }, { type: "every", every: "1 hour" } or { type: "cron", cron: "0 9 * * 1-5" }. Optional with `until` (defaults to { type: "every", every: "30 seconds" }).',
  }),
  if: Condition.pipe(optional).annotate({
    description:
      'Recurring gate ({ type: "shell", run } or { type: "code", code }): check on each slot with no model call, and run `action` on every slot where it passes.',
  }),
  until: Condition.pipe(optional).annotate({
    description:
      'One-shot gate ({ type: "shell", run } or { type: "code", code }): poll with no model call, run `action` once when it passes, and stop. Defaults `ends.after` to "24 hours".',
  }),
  ends: Ends.pipe(optional).annotate({
    description: 'Stops a repeating schedule at the first limit reached: { after: "8 hours" }, { at }, { times: 3 }.',
  }),
  action: Action.annotate({
    description:
      'What runs when the schedule fires: { type: "prompt", prompt, target? }, { type: "command", name, arguments?, target? }, { type: "shell", run, notify? }, or { type: "code", code, notify? }.',
  }),
}).annotate({ identifier: "Schedule.Request" })
export type Request = typeof Request.Type

export const CreateInput = Schema.Struct({
  sessionID: SessionID,
  ...Request.fields,
}).annotate({ identifier: "Schedule.CreateInput" })
export type CreateInput = typeof CreateInput.Type
