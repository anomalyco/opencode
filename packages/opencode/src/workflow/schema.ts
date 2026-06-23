// Workflow data schemas (Zod/Effect-Schema), split out of workflow.ts so the
// engine, the persistence layer, the meta reader, and the HTTP layer share one
// definition of the run/log/agent shapes without pulling in the full engine.
// Every symbol here is re-exported from the workflow.ts barrel, so the public
// `Workflow.RunID` / `Workflow.Info` / `Workflow.Run` / … surface is unchanged.
import { Schema } from "effect"
import { EventV2 } from "@opencode-ai/core/event"
import { type DeepMutable, withStatics } from "@opencode-ai/core/schema"
import type { WorkflowAgentRow, WorkflowDefinitionRow, WorkflowLogRow } from "@opencode-ai/core/workflow/sql"
import { Identifier } from "@/id/id"
import { Meta } from "./meta"

// Branded id for a workflow run. Follows the repo's ID convention (cf. SessionID
// / MessageID in `session/schema.ts`): a `job_`-prefixed string carrying a
// nominal brand so a run id can never be confused with any other string at the
// type level. The brand is type-only — the `isStartsWith("job")` check is the
// same shape SessionID uses, which the OpenAPI generator emits as a plain
// `string`, so the SDK shape is unchanged. `make` mints a fresh ascending id
// (the prefix the engine already used via `Identifier.ascending("job")`).
export const RunID = Schema.String.check(Schema.isStartsWith("job")).pipe(
  Schema.brand("WorkflowRunID"),
  withStatics((schema) => ({
    ascending: (id?: string) => schema.make(Identifier.ascending("job", id)),
  })),
)
export type RunID = Schema.Schema.Type<typeof RunID>

// Meta/Argument schemas live in `./meta` (a Schema-only leaf module) so the
// static meta reader can share them without forming an import cycle. Re-exported
// here so the engine's public `Workflow.Meta` / `Workflow.Argument` API is
// unchanged.
export { Argument, Meta, Phase } from "./meta"

export const Info = Schema.Struct({
  name: Schema.String,
  path: Schema.String,
  meta: Meta,
  // `valid: false` marks a file that failed to load (bad meta / missing run /
  // syntax error). It is still returned so a single broken file never makes the
  // whole list fail; `error` carries the load failure as a human-readable
  // string. Valid entries are explicitly `valid: true` (never omitted).
  valid: Schema.Boolean,
  error: Schema.optional(Schema.String),
  // `source_kind: "builtin"` flags a workflow that ships INSIDE opencode (its
  // module source is a bundled string, `path` is the synthetic `builtin:<name>`
  // marker, not a real file). Omitted for the common case of an on-disk
  // project/global file. Builtins are the lowest-precedence discovery root:
  // a same-named project or global file shadows the builtin entirely.
  source_kind: Schema.optional(Schema.Literals(["builtin"])),
}).annotate({ identifier: "WorkflowInfo" })
export type Info = Schema.Schema.Type<typeof Info>

// The resolved module SOURCE of a single named workflow, returned by `read(name)`
// / `GET /workflow/:name/source` for the pre-run approval preview. Kept SEPARATE
// from `Info` (and off `list()`) on purpose: `list()` is hit for autocomplete and
// the slash popover and returns EVERY workflow, so inlining each one's full module
// text would bloat that hot, name+meta-only payload — whereas the source is only
// needed lazily when an operator opens the "View script" preview for one workflow.
// `source_kind: "builtin"` is mirrored from Info so a consumer can label a builtin.
export const Source = Schema.Struct({
  name: Schema.String,
  path: Schema.String,
  source: Schema.String,
  source_kind: Schema.optional(Schema.Literals(["builtin"])),
}).annotate({ identifier: "WorkflowSource" })
export type Source = Schema.Schema.Type<typeof Source>

export const Definition = Schema.Struct({
  name: Schema.String,
  path: Schema.String,
  meta: Meta,
  source: Schema.optional(Schema.String),
  temporary: Schema.optional(Schema.Boolean),
}).annotate({ identifier: "WorkflowDefinition" })
export type Definition = DeepMutable<Schema.Schema.Type<typeof Definition>>

// "interrupted" is a terminal status assigned to runs whose in-memory fiber was
// lost (crash/process restart) while the DB row still said "running". The orphan
// sweep on service start rewrites such zombie rows so the lifecycle stays honest.
//
// "paused" is the only NON-terminal status besides "running": a run the user
// explicitly suspended via pause() (sessions aborted, scope closed, fiber
// interrupted — exactly like cancel), but whose persisted agent journal is kept
// intact so a later resume can replay the completed agents instead of re-running
// them. The orphan sweep deliberately ignores paused rows (they have no live
// fiber by design, but they are parked, not lost); cancel() on a paused run moves
// it to the terminal "cancelled"; wait() on a paused run returns its snapshot at
// once (timedOut:false) because there is no live fiber to await.
export const Status = Schema.Literals(["running", "completed", "failed", "cancelled", "interrupted", "paused"])
export type Status = Schema.Schema.Type<typeof Status>

export const LogEntry = Schema.Struct({
  // Epoch millis — always a finite number. `Schema.Finite` (not `Schema.Number`)
  // so the generated SDK wire type is a plain `number`, not the dishonest
  // `number | "NaN" | "Infinity" | …` union the OpenAPI generator emits for an
  // unbounded `Schema.Number` (Fund 18). Same JS Type (`number`) as before, so
  // the core row-type SSoT assertions stay valid.
  time: Schema.Finite,
  phase: Schema.optional(Schema.String),
  message: Schema.String,
}).annotate({ identifier: "WorkflowLogEntry" })
export type LogEntry = DeepMutable<Schema.Schema.Type<typeof LogEntry>>

export const AgentRun = Schema.Struct({
  id: Schema.String,
  // `skipped` (Item 15): a human skipped this step via skipAgent — the step's
  // ctx.agent call resolved `null` and the run continued. Distinct from `failed`
  // so run views can tell a deliberate skip apart from an error.
  status: Schema.Literals(["running", "completed", "failed", "skipped"]),
  // Epoch millis — always finite. `Schema.Finite` keeps the SDK wire type a
  // plain `number` instead of the NaN/Infinity-string union (Fund 18).
  started_at: Schema.Finite,
  completed_at: Schema.optional(Schema.Finite),
  phase: Schema.optional(Schema.String),
  agent: Schema.optional(Schema.String),
  // Per-call display name (Item 16): set from `ctx.agent({ label })` so run views
  // can show an author-chosen step name instead of the agent name. Display-only —
  // deliberately NOT part of the resume journal key (see journalKey).
  label: Schema.optional(Schema.String),
  model: Schema.optional(Schema.String),
  session_id: Schema.optional(Schema.String),
  message_id: Schema.optional(Schema.String),
  // Item 7: the isolated `git worktree` base directory this step ran in (set
  // only for `isolation: "worktree"` steps). Makes the step's work location
  // inspectable (inspect/dashboard) and anchors the preserve log when the
  // worktree is kept at run end (uncommitted changes / new commits).
  worktree: Schema.optional(Schema.String),
  prompt: Schema.String,
  output: Schema.optional(Schema.String),
  cost: Schema.optional(Schema.Finite),
  tokens: Schema.optional(
    Schema.Struct({
      total: Schema.optional(Schema.Finite),
      input: Schema.Finite,
      output: Schema.Finite,
      reasoning: Schema.Finite,
      cache: Schema.Struct({
        read: Schema.Finite,
        write: Schema.Finite,
      }),
    }),
  ),
  error: Schema.optional(Schema.String),
  // `true` when this agent node was NOT executed live but replayed verbatim from
  // a resumed run's persisted journal (output/structured/cost/tokens copied from
  // the source run's matching completed agent). Omitted (⇒ undefined) for a live
  // step. Lets the dashboard mark a cheap, re-used step apart from a fresh one.
  cached: Schema.optional(Schema.Boolean),
  // The journal node KIND (Tasks 12/13). `"question"` marks a human-in-the-loop
  // `ctx.question` step (its `prompt` is the question text, `answer` is filled in
  // on reply); `"agent"` (or absent — old rows) is an ordinary LLM step. The field
  // is optional so rows written before it existed decode cleanly (undefined ⇒ an
  // agent node), which is the decode-tolerance the persistence contract relies on.
  kind: Schema.optional(Schema.Literals(["agent", "question"])),
  // The answer recorded on a `kind:"question"` node once the question is answered
  // (live) or replayed from a resumed run's journal. Omitted while open / for an
  // agent node. Resume replay matches a question node on [kind, question, phase]
  // and copies this answer back to the body, mirroring the agent-journal replay.
  answer: Schema.optional(Schema.String),
}).annotate({ identifier: "WorkflowAgentRun" })
export type AgentRun = DeepMutable<Schema.Schema.Type<typeof AgentRun>>

// Compile-time SSoT bridge between the engine's runtime validators (the Effect
// schemas above) and core's persistence contract (the row types that annotate the
// workflow_run JSON columns). The engine keeps the Effect schemas as the runtime
// validators; core keeps the row types as the canonical column shapes. These
// bidirectional assignability checks fail the build the moment either side drifts
// — a field added/removed/retyped, or the AgentRun status union widened — so the
// silent drift that motivated this refactor cannot recur. Two directions are
// needed because a one-way `extends` only catches a SUPERSET on one side; both
// directions together pin the shapes to be mutually assignable (structurally
// identical for these closed object types). `void` keeps the consts from being
// reported as unused.
const _defToRow: WorkflowDefinitionRow = {} as Definition
const _defFromRow: Definition = {} as WorkflowDefinitionRow
const _logToRow: WorkflowLogRow = {} as LogEntry
const _logFromRow: LogEntry = {} as WorkflowLogRow
const _agentToRow: WorkflowAgentRow = {} as AgentRun
const _agentFromRow: AgentRun = {} as WorkflowAgentRow
void _defToRow
void _defFromRow
void _logToRow
void _logFromRow
void _agentToRow
void _agentFromRow

export const Run = Schema.Struct({
  id: RunID,
  session_id: Schema.optional(Schema.String),
  workflow: Schema.String,
  args: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
  definition: Schema.optional(Definition),
  status: Status,
  started_at: Schema.Number,
  completed_at: Schema.optional(Schema.Number),
  current_phase: Schema.optional(Schema.String),
  logs: Schema.Array(LogEntry),
  agents: Schema.Array(AgentRun),
  result: Schema.optional(Schema.Unknown),
  error: Schema.optional(Schema.String),
  // Set when this run was started as a resume of a previous (paused/interrupted)
  // run: the id of that source run, whose persisted journal was replayed.
  // Omitted for an ordinary (non-resume) run.
  resume_of: Schema.optional(RunID),
  // The open human-in-the-loop question this run is currently waiting on
  // (Tasks 12/13). Set while `ctx.question` is awaited and not yet answered;
  // cleared once the answer lands (live) or the question node is replayed during a
  // resume. A timed-out question parks the run as `paused` with this still set, so
  // the open question survives across restarts. Omitted when no question pends.
  pending_question: Schema.optional(
    Schema.Struct({
      question: Schema.String,
      options: Schema.optional(Schema.Array(Schema.String)),
      asked_at: Schema.Number,
    }),
  ),
}).annotate({ identifier: "WorkflowRun" })
export type Run = DeepMutable<Schema.Schema.Type<typeof Run>>

// Run-lifecycle bus events. Published from `persistRun` (the single choke-point
// every state write goes through) AFTER the DB upsert commits, so a consumer
// never observes a state that was not persisted. The payload is intentionally
// SLIM — the metadata fields plus an `agents` COUNT object — so non-TUI
// consumers (dashboard, plugins) can render run progress without the heavy
// logs/agents/result blobs (those stay readable via `get()`). `updated` fires on
// every non-terminal write; `finished` fires once on the terminal write.
const RunEventData = {
  id: Schema.String,
  workflow: Schema.String,
  status: Status,
  current_phase: Schema.NullOr(Schema.String),
  directory: Schema.String,
  agents: Schema.Struct({
    total: Schema.Number,
    running: Schema.Number,
    failed: Schema.Number,
  }),
  // `true` while this run is waiting on an open human-in-the-loop question
  // (`ctx.question` awaited, not yet answered — Tasks 12/13), so a non-TUI
  // consumer can surface the prompt without reading the full run. The detail
  // (question text/options) stays on `get()`'s `pending_question`; the event
  // only flags THAT one pends, keeping the payload slim.
  pending_question: Schema.Boolean,
  error: Schema.NullOr(Schema.String),
}
export const Event = {
  Updated: EventV2.define({ type: "workflow.run.updated", schema: RunEventData }),
  Finished: EventV2.define({ type: "workflow.run.finished", schema: RunEventData }),
}
