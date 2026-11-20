export * as Automation from "./automation.js"

import { Duration, Option, Schema } from "effect"
import { Agent } from "./agent.js"
import { ascending } from "./identifier.js"
import { ProjectID } from "./project-id.js"
import { DateTimeUtcFromMillis, NonNegativeInt, optional, statics } from "./schema.js"
import { SessionID } from "./session-id.js"

export const ID = Schema.String.check(Schema.isStartingWith("aut_")).pipe(
  Schema.brand("Automation.ID"),
  Schema.annotate({ identifier: "Automation.ID" }),
  statics((schema) => ({
    create: () => schema.make("aut_" + ascending()),
  })),
)
export type ID = typeof ID.Type

const decodeDuration = Schema.decodeUnknownOption(Schema.DurationFromString)

/** Milliseconds in a duration string, or `None` when it is not one. */
export const durationMillis = (value: string) => decodeDuration(value).pipe(Option.map(Duration.toMillis))

/** A duration such as "90 seconds", "5 minutes" or "2 hours". The service validates it, since clients cannot run a custom check. */
export const DurationString = Schema.String.annotate({
  identifier: "Automation.Duration",
  description: 'A duration such as "90 seconds", "5 minutes" or "2 hours".',
})

const zone = {
  tz: Schema.String.pipe(optional).annotate({
    description: "IANA time zone. Defaults to the configured timezone, then the server's local zone.",
  }),
}

/** Runs once: at an instant with an offset, a wall-clock time in `tz` such as "2026-10-27T09:00", or "in 10 minutes". */
export const At = Schema.Struct({
  type: Schema.tag("at"),
  at: Schema.String.annotate({
    description: 'An instant with an offset, a wall-clock time in tz such as "2026-10-27T09:00", or "in 10 minutes".',
  }),
  ...zone,
}).annotate({ identifier: "Automation.Trigger.At" })
export interface At extends Schema.Schema.Type<typeof At> {}
export const Every = Schema.Struct({ type: Schema.tag("every"), every: DurationString, ...zone }).annotate({
  identifier: "Automation.Trigger.Every",
})
export interface Every extends Schema.Schema.Type<typeof Every> {}
export const Cron = Schema.Struct({ type: Schema.tag("cron"), cron: Schema.String, ...zone }).annotate({
  identifier: "Automation.Trigger.Cron",
})
export interface Cron extends Schema.Schema.Type<typeof Cron> {}

export const Event = Schema.Struct({
  type: Schema.tag("event"),
  server: Schema.NonEmptyString,
  event: Schema.NonEmptyString,
  args: Schema.Record(Schema.String, Schema.Json).pipe(optional),
}).annotate({ identifier: "Automation.Trigger.Event" })
export interface Event extends Schema.Schema.Type<typeof Event> {}

export const Trigger = Schema.Union([At, Every, Cron, Event]).pipe(
  Schema.toTaggedUnion("type"),
  Schema.annotate({ identifier: "Automation.Trigger" }),
)
export type Trigger = typeof Trigger.Type

/** Declares a variant field absent, so `{ session, subagent }` fails instead of silently dropping one. */
const absent = Schema.optionalKey(Schema.Never)

/** Where a prompt action goes: an existing Session, or a new child of the creating Session with an agent on every run. */
export const Target = Schema.Union([
  Schema.Struct({ session: SessionID, subagent: absent }),
  Schema.Struct({ subagent: Agent.ID, session: absent }),
]).annotate({ identifier: "Automation.Target" })
export type Target = typeof Target.Type

/** The child Session a `{ subagent }` run starts, derived from the run so a retry adopts it instead of starting another. */
export const runSessionID = (id: ID, run: number) => SessionID.make(`ses_${id}_${run}`)

/** Whether a Session is a `{ subagent }` run's child, which finishes without reporting to or waking its parent. */
export const isRunSession = (sessionID: SessionID) => sessionID.startsWith("ses_aut_")

export const PromptAction = Schema.Struct({ type: Schema.tag("prompt"), prompt: Schema.String, to: Target }).annotate({
  identifier: "Automation.Action.Prompt",
})
export interface PromptAction extends Schema.Schema.Type<typeof PromptAction> {}

/** Code can hand off one prompt, but cannot choose a Session by id. Reject unknown keys rather than dropping a target. */
export const CodeResult = Schema.Struct({
  state: Schema.Json.pipe(optional),
  done: Schema.Boolean.pipe(optional),
  send: Schema.Struct({
    prompt: Schema.String.check(Schema.isPattern(/\S/)),
    to: Schema.Struct({ subagent: Agent.ID.check(Schema.isPattern(/\S/)) }).pipe(optional),
  }).pipe(optional),
}).annotate({ identifier: "Automation.CodeResult" })
export interface CodeResult extends Schema.Schema.Type<typeof CodeResult> {}
// Code Mode represents a program that returns nothing as JSON null.
export const decodeCodeResult = Schema.decodeUnknownResult(Schema.NullOr(CodeResult), { onExcessProperty: "error" })

/**
 * Runs `code` in a confined Code Mode runtime with no model call and no `fetch`. Tools called statically as
 * `tools.<path>(...)` are extracted from the AST and authorized at creation. The program receives
 * `input = { state, now, runs, args, event? }` and returns nothing or a `CodeResult`.
 */
export const CodeAction = Schema.Struct({
  type: Schema.tag("code"),
  code: Schema.String,
  args: Schema.Json.pipe(optional),
}).annotate({ identifier: "Automation.Action.Code" })
export interface CodeAction extends Schema.Schema.Type<typeof CodeAction> {}

const shellFields = { type: Schema.tag("shell"), command: Schema.NonEmptyString }

export const ShellAction = Schema.Struct(shellFields).annotate({ identifier: "Automation.Action.Shell" })
export interface ShellAction extends Schema.Schema.Type<typeof ShellAction> {}

export const Action = Schema.Union([PromptAction, CodeAction, ShellAction]).pipe(
  Schema.toTaggedUnion("type"),
  Schema.annotate({ identifier: "Automation.Action" }),
)
export type Action = typeof Action.Type

export const Status = Schema.Literals(["active", "paused", "done"]).annotate({ identifier: "Automation.Status" })
export type Status = typeof Status.Type

export const Outcome = Schema.Literals(["fired", "late", "skipped", "disabled", "failed", "expired"]).annotate({
  identifier: "Automation.Outcome",
})
export type Outcome = typeof Outcome.Type

export const Info = Schema.Struct({
  id: ID,
  name: Schema.String,
  projectID: ProjectID,
  /** The Session that created it, if any. Deleting that Session does not delete the automation. */
  sessionID: SessionID.pipe(optional),
  directory: Schema.String,
  trigger: Trigger,
  tz: Schema.String,
  action: Action,
  expires: DateTimeUtcFromMillis.pipe(optional),
  status: Status,
  nextDueAt: DateTimeUtcFromMillis.pipe(optional),
  runCount: NonNegativeInt,
  lastRunAt: DateTimeUtcFromMillis.pipe(optional),
  lastOutcome: Outcome.pipe(optional),
  lastOutput: Schema.String.pipe(optional),
  state: Schema.Json.pipe(optional),
  time: Schema.Struct({ created: DateTimeUtcFromMillis, updated: DateTimeUtcFromMillis }),
}).annotate({ identifier: "Automation.Info" })
export interface Info extends Schema.Schema.Type<typeof Info> {}

export const PromptActionInput = Schema.Struct({
  type: Schema.tag("prompt"),
  prompt: Schema.String.check(Schema.isMinLength(1)).annotate({
    description: "The message the target Session receives, with enough context to act on it without this conversation.",
  }),
  to: Target.pipe(optional).annotate({
    description:
      'Where the prompt goes: { session: "ses_..." }, or { subagent: "<agent>" } to start a new child of the creating Session with that agent each run. Defaults to the creating Session.',
  }),
}).annotate({ identifier: "Automation.PromptActionInput" })
export interface PromptActionInput extends Schema.Schema.Type<typeof PromptActionInput> {}

export const CodeActionInput = Schema.Struct({
  type: Schema.tag("code"),
  code: Schema.String.check(Schema.isMinLength(1)).annotate({
    description: [
      "Code Mode JavaScript run on each trigger with no model (no fetch; 30s, 20 tool calls, 32 KB output cap).",
      'Call tools statically as tools.<ns>.<tool>(...) or tools["ns-name"].tool(...); each is authorized once at creation to run unattended.',
      "Receives input = { state, now, runs, args } (also globals): state starts null, now is epoch ms, runs counts earlier runs.",
      "Event triggers also receive input.event = { id, timestamp, data }; data follows the event type's payloadSchema.",
      "Return nothing, or { state?, done?, send? }. JSON state is kept for the next run; done: true stops. lastOutput shows the delivery target and any logs.",
      "Return at most one send per run. { send: { prompt } } steers the creating session; { send: { prompt, to: { subagent } } } starts a permitted child that does not report back. No session IDs. Omit send to stay quiet. A rejected send commits neither state nor done.",
      'Example code string: if (runs < 2) return; return { done: true, send: { prompt: "Three checks elapsed. Review the build." } }',
    ].join(" "),
  }),
  args: Schema.Json.pipe(optional).annotate({ description: "JSON passed to every run as input.args." }),
}).annotate({ identifier: "Automation.CodeActionInput" })
export interface CodeActionInput extends Schema.Schema.Type<typeof CodeActionInput> {}

export const ShellActionInput = Schema.Struct({
  ...shellFields,
  command: shellFields.command.annotate({
    description: "The fixed shell command to run on each trigger without a model.",
  }),
}).annotate({ identifier: "Automation.ShellActionInput" })
export interface ShellActionInput extends Schema.Schema.Type<typeof ShellActionInput> {}

export const ActionInput = Schema.Union([PromptActionInput, CodeActionInput, ShellActionInput]).pipe(
  Schema.toTaggedUnion("type"),
  Schema.annotate({ identifier: "Automation.ActionInput" }),
)
export type ActionInput = typeof ActionInput.Type

/** An automation as callers describe it: a name, when it runs, what it does, and when it stops. */
export const Request = Schema.Struct({
  name: Schema.String.check(Schema.isMinLength(1)).annotate({ description: "A short label shown in lists." }),
  trigger: Trigger.annotate({
    description:
      'When it runs: { type: "at", at: "in 20 minutes" | "2026-10-27T09:00" }, { type: "every", every: "1 hour" } or { type: "cron", cron: "0 9 * * 1-5" }, each with an optional tz. Or { type: "event", server, event, args? } for a connected MCP server advertising push delivery (requires mcp_events).',
  }),
  action: ActionInput.annotate({
    description:
      'What it does: { type: "prompt", prompt, to? } sends a prompt; { type: "code", code, args? } runs Code Mode; { type: "shell", command } runs a fixed shell command.',
  }),
  expires: Schema.String.pipe(optional).annotate({
    description: 'When it stops for good: an instant, a wall-clock time in tz, or "in 8 hours".',
  }),
}).annotate({ identifier: "Automation.Request" })
export interface Request extends Schema.Schema.Type<typeof Request> {}

export const CreateInput = Schema.Struct({
  // A creating Session supplies the directory, default recipient, and authority for code or child actions.
  sessionID: SessionID.pipe(optional),
  directory: Schema.String.annotate({
    description: "Where it runs when there is no Session. Defaults to the server user's home folder.",
  }).pipe(optional),
  ...Request.fields,
}).annotate({ identifier: "Automation.CreateInput" })
export interface CreateInput extends Schema.Schema.Type<typeof CreateInput> {}
