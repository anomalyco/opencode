import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Config } from "@/config/config"
import { Agent } from "@/agent/agent"
import { deriveSubagentSessionPermission } from "@/agent/subagent-permissions"
import { EffectBridge } from "@/effect/bridge"
import { EventV2Bridge } from "@/event-v2-bridge"
import { EventV2 } from "@opencode-ai/core/event"
import { InstanceState } from "@/effect/instance-state"
import { InstanceRef } from "@/effect/instance-ref"
import { Identifier } from "@/id/id"
import { Provider } from "@/provider/provider"
import { Session } from "@/session/session"
import type { SessionPrompt } from "@/session/prompt"
import { SessionID } from "@/session/schema"
import { SubagentLimits } from "@/session/subagent-limits"
import { Database } from "@opencode-ai/core/database/database"
import { Global } from "@opencode-ai/core/global"
import { Permission } from "@/permission"
import { PermissionV1 } from "@opencode-ai/core/v1/permission"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { ChildProcessSpawner } from "effect/unstable/process/ChildProcessSpawner"
import { scanCommand } from "@/tool/shell"
import { ShellID } from "@/tool/shell/id"
import { TurnBudget } from "@/session/turn-budget"
import { ModelV2 } from "@opencode-ai/core/model"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { SessionV1 } from "@opencode-ai/core/v1/session"
import { type DeepMutable, withStatics } from "@opencode-ai/core/schema"
import type { WorkflowAgentRow, WorkflowDefinitionRow, WorkflowLogRow } from "@opencode-ai/core/workflow/sql"
import { Glob } from "@opencode-ai/core/util/glob"
import { and, desc, eq, isNotNull, notInArray } from "drizzle-orm"
import { APICallError } from "ai"
import { spawnSync } from "child_process"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { pathToFileURL } from "url"
import {
  Cause,
  Clock,
  Context,
  Deferred,
  Effect,
  Exit,
  Fiber,
  Layer,
  Scope,
  Schema,
  Semaphore,
  SynchronizedRef,
} from "effect"
import type {
  WorkflowContext,
  WorkflowParallelOptions,
  WorkflowPipelineFn,
  WorkflowPipelineOptions,
  WorkflowPipelineStage,
} from "@opencode-ai/plugin/workflow"
import { WorkflowRunTable } from "./workflow.sql"
import { MetaReader } from "./meta-reader"
import { Meta } from "./meta"
import { BUILTIN_WORKFLOWS, builtinPath, inlinePath } from "./builtin"
import { Process } from "@/util/process"
import { Shell } from "@/shell/shell"

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
import { Phase, encodePhase } from "./meta"

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

// Non-negative finite number — the only shape a budget cap may take: a
// negative/NaN/Infinity cap is a validation error at the boundary, never a
// confusing runtime budget failure.
const NonNegFinite = Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0))

// Item 17: the budget cap. A NAKED number stays USD (backward compatibility for
// every existing caller); the struct form adds an independent output-TOKEN cap.
// Both caps may be set — whichever exhausts first gates the next step.
const BudgetInput = Schema.Union([
  NonNegFinite,
  Schema.Struct({
    usd: Schema.optional(NonNegFinite),
    tokens: Schema.optional(NonNegFinite),
  }),
])

export const StartInput = Schema.Struct({
  // Optional so an inline-source start can omit it: when `source` is supplied with
  // no `name`, start() loads the module straight from the source string (the
  // builtin source-string load path) and the run's name is the source's meta name.
  // Every other start path supplies a name to select a discovered workflow.
  name: Schema.optional(Schema.String),
  args: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
  // Optional cost cap for the whole run: a naked number is USD (back-compat), the
  // struct form is `{ usd?, tokens? }`. USD is gated against the per-agent cost
  // telemetry the engine already records (`AgentRun.cost`); tokens against each
  // step's output+reasoning tokens (Item 17). After each agent step the spend
  // accumulators advance; before each `ctx.agent` call the engine fails the step
  // with a BudgetExceededError once a set cap is exhausted. Omitted ⇒ unlimited.
  budget: Schema.optional(BudgetInput),
}).annotate({ identifier: "WorkflowStartInput" })
export type StartInput = Schema.Schema.Type<typeof StartInput>

export type PromptOps = {
  prompt: (input: SessionPrompt.PromptInput) => Effect.Effect<SessionV1.WithParts, unknown>
  /**
   * Aborts a running agent session (the same path TUI Esc / `POST /:id/abort`
   * use). The workflow engine calls this for every tracked child session when a
   * run is cancelled so no tokens keep burning after cancel. Optional so callers
   * that never start agents need not provide it.
   */
  cancel?: (sessionID: SessionID) => Effect.Effect<void>
  /**
   * The RESOLVED model of a session (session.model → last user-message model →
   * provider default). The workflow tool reads the CALLER session's model
   * through this before start so default-agent steps can inherit it (Item 12).
   * Optional so existing prompt-ops stubs keep compiling.
   */
  currentModel?: (
    sessionID: SessionID,
  ) => Effect.Effect<{ providerID: string; modelID: string; variant?: string }, unknown>
}

export type StartOptions = StartInput & {
  prompt?: PromptOps
  source?: string
  temporary?: boolean
  permissionSessionID?: SessionID
  /**
   * Identity of the caller that started this run (the tool/session that asked).
   * `sessionID` is used to derive the inherited `permission` ruleset for every
   * subagent session the run spawns (parent-session deny/external_directory
   * rules; since #31696 parent-AGENT restrictions are deliberately NOT
   * inherited — plan mode is instead gated by the plan agent's `workflow`
   * deny). This is distinct from `permissionSessionID`, which only controls
   * WHERE interactive permission prompts surface, not WHICH rules apply.
   * Absent on a purely programmatic/HTTP start with no session identity — the
   * documented fallback (no inherited ruleset) preserves the prior behavior.
   * `agent` is currently informational only.
   */
  caller?: { sessionID: SessionID; agent?: string }
  /**
   * Item 24: the caller TURN's shared budget pool — a live, shared mutable
   * object (NOT a schema field; it is not serializable and binds to exactly
   * one prompt turn). When set, every `ctx.agent` step must pass BOTH the
   * per-run budget gate AND an atomic pool reservation; the main loop charges
   * the same pool directly, so two runs of one turn compete for one cap.
   * Absent on HTTP/programmatic starts and on resumes (a resume turn brings
   * its own pool).
   */
  pool?: TurnBudget.Pool
  /**
   * The caller session's RESOLVED model at start time (Item 12), already parsed
   * into `{ providerID, modelID }` — never re-parsed via Provider.parseModel.
   * A `ctx.agent` step that uses the DEFAULT agent (no `agent:` override) and
   * has no explicit/phase model resolves to this, so subagents follow the main
   * loop's model (incl. a TUI model switch). An explicitly chosen agent is a
   * deliberate authoring decision including its model, so it is unaffected.
   * Absent on HTTP/programmatic starts with no session-model context.
   */
  caller_model?: { providerID: string; modelID: string }
  /**
   * Resume a previous (paused, interrupted, failed, or completed) run by id.
   * When set, start() loads the SOURCE run's persisted agent journal
   * (directory-scoped, like get()) and builds
   * a replay map keyed by the agent's call shape + occurrence index. As the new
   * run re-executes the SAME workflow body, each `ctx.agent` call first looks up
   * the journal: a matching COMPLETED source agent (whose index is not in
   * `invalidate_agents`) is replayed verbatim (output/structured/cost/tokens,
   * `cached: true`) with NO prompt, and the replayed cost is charged once via the
   * shared `ensuring` (post-step), just like a live step; a miss runs live. The
   * budget gate before the lookup still fails honestly when exhausted. The resume
   * is cross-restart because the journal lives in the DB, not in memory.
   */
  resume_of?: RunID
  /**
   * Replay strategy for the resume journal (Item 20). Only meaningful together
   * with `resume_of`:
   * - `"prefix"` (DEFAULT, the safe mode): the journal is the source run's
   *   agents in ORIGINAL ORDER and replay stops PERMANENTLY at the first
   *   mismatch (a changed call, a non-completed source node, or an
   *   `invalidate_agents` index) — every later call runs live, even if its
   *   shape is unchanged. Rationale: shape-matching would serve a LATER
   *   unchanged call from the journal although its workspace side effects may
   *   be stale after an earlier step changed.
   * - `"keyed"`: the previous shape-matching behavior, kept 1:1 for read-only
   *   workflows (and recommended for heavily parallel ones, where dispatch
   *   order within a parallel batch is not deterministic and could spuriously
   *   break a prefix — prefix then degrades safely to live: more expensive,
   *   never wrong).
   * The default flip from keyed to prefix is a deliberate behavior change.
   */
  replay?: "prefix" | "keyed"
  /**
   * Source-journal agent indices (0-based, in the source run's `agents[]` order)
   * to FORCE live re-execution of during a resume, even if they completed. Only
   * meaningful together with `resume_of`. An index here is excluded from journal
   * replay, so its `ctx.agent` call runs live and re-prompts. In `prefix` replay
   * mode (the default), everything AFTER the first invalidated agent re-runs
   * live too — the invalidated index breaks the prefix permanently.
   */
  invalidate_agents?: number[]
  /**
   * Seeded answers for a resume that picks up a run parked on a `ctx.question`
   * (Tasks 12/13). A map of question TEXT → answer. During the resume the engine
   * builds a question journal from the source run's `kind:"question"` nodes; on
   * reaching the matching `ctx.question` the body is served the seeded answer
   * (and the node is marked `cached`) instead of asking the user again. Only
   * meaningful together with `resume_of`. Set by `answer()` on a paused run;
   * unused by an ordinary resume.
   */
  questionAnswers?: Record<string, string>
}

export type WaitInput = {
  id: RunID
  timeout?: number
}

export type WaitResult = {
  run?: Run
  timedOut: boolean
}

export type AnswerInput = {
  id: RunID
  answer: string
  /**
   * Execution options forwarded UNCHANGED into the resume that `answer()` starts
   * when the target run is `paused` on a question (Tasks 12/13). These mirror the
   * subset of `StartOptions` the resume path consumes, so a workflow that asks a
   * question and then dispatches more `ctx.agent` steps can run those steps on the
   * resumed run. Ignored on the live-answer path (no resume happens). All optional
   * for backward compatibility:
   * - `prompt`: the prompt-ops vector (dispatch + abort) the agent steps need.
   * - `permissionSessionID`: where interactive permission prompts surface.
   * - `caller`: identity used to derive each subagent's inherited permission ruleset.
   * - `budget`: cost cap for the resumed run — naked number = USD (back-compat),
   *   or `{ usd?, tokens? }` (Item 17), mirroring StartInput.budget.
   */
  prompt?: PromptOps
  permissionSessionID?: SessionID
  caller?: { sessionID: SessionID; agent?: string }
  budget?: number | { usd?: number; tokens?: number }
}

// Where save() writes a workflow file. `project` (default) targets the workspace
// `.opencode/workflows` dir discover() globs first; `global` targets the global
// config `workflows` dir. Mirrors the TUI save dialog's project/global toggle.
export type SaveScope = "project" | "global"

export type SaveInput = {
  name: string
  source: string
  scope?: SaveScope
}

export class NotFoundError extends Schema.TaggedErrorClass<NotFoundError>()("WorkflowNotFoundError", {
  name: Schema.String,
}) {}

export class InvalidError extends Schema.TaggedErrorClass<InvalidError>()("WorkflowInvalidError", {
  path: Schema.String,
  message: Schema.String,
}) {}

// Raised by save() when a workflow file already exists at the resolved
// destination. Save NEVER overwrites — it mirrors the create tool's behavior
// (`Workflow already exists: …`), so an accidental re-save of a run cannot clobber
// a hand-edited file. The HTTP handler maps this to a 409 ConflictError; `name` is
// the workflow file base and `path` the colliding file so callers can surface both.
export class SaveConflictError extends Schema.TaggedErrorClass<SaveConflictError>()("WorkflowSaveConflictError", {
  name: Schema.String,
  path: Schema.String,
}) {}

/**
 * Raised by an agent step that requested structured output (a `schema` was
 * passed to `ctx.agent`) when the session produced no parsed structured result —
 * either because the underlying session set a `StructuredOutputError` on the
 * assistant message, or because `structured` came back `undefined`. The engine
 * MUST NOT silently fall back to plaintext when a schema was requested: a missing
 * structured result is a genuine step failure, so this error propagates through
 * the same agent-failure path as any other agent error (node `failed`, run
 * `failed` unless the workflow module catches it).
 */
export class StructuredOutputError extends Schema.TaggedErrorClass<StructuredOutputError>()(
  "WorkflowStructuredOutputError",
  {
    message: Schema.String,
  },
) {}

/**
 * Raised at the top of `ctx.agent` (right after the abort-signal checkpoint)
 * when the run was started with a budget and that budget is exhausted
 * (`budgetRemaining <= 0`). The next agent step never starts: the engine
 * refuses to spend past the cap. Propagates through the SAME agent-failure path
 * as any other agent error (node `failed`, run `failed` unless the workflow
 * module catches it). The message names both the configured budget and the
 * amount already spent so the failure is self-explanatory.
 *
 * The cap is enforced PER STEP, best-effort: it is checked before each
 * `ctx.agent` call and the spend is settled after each step. Steps launched
 * concurrently via `ctx.parallel`/`ctx.pipeline` all pass the gate while the
 * budget is still positive, so a run can overspend by up to the combined cost
 * of the steps already in flight when the budget runs out. This is a soft cap,
 * not a hard mid-step limit.
 */
export class BudgetExceededError extends Schema.TaggedErrorClass<BudgetExceededError>()("WorkflowBudgetExceededError", {
  message: Schema.String,
  budget: Schema.Finite,
  spent: Schema.Finite,
  // Item 17: which cap tripped — "usd" (cost) or "tokens" (output tokens).
  // Optional for backward compatibility with errors persisted before the field.
  unit: Schema.optional(Schema.Literals(["usd", "tokens"])),
}) {}

/**
 * Raised at the top of `ctx.agent` once the run has already STARTED its
 * lifetime-cap many agents (default 1.000). The cap is a per-run safety ceiling
 * on the TOTAL number of agent dispatches a single workflow run may launch, so a
 * pathological or runaway workflow (e.g. an unbounded loop of `ctx.agent`) cannot
 * spawn unbounded subagent sessions. Like BudgetExceededError it propagates
 * through the SAME agent-failure path as any other agent error (node `failed`,
 * run `failed` unless the workflow module catches it). The message names both the
 * limit and the count already started so the failure is self-explanatory.
 */
export class AgentLimitError extends Schema.TaggedErrorClass<AgentLimitError>()("WorkflowAgentLimitError", {
  message: Schema.String,
  limit: Schema.Finite,
  started: Schema.Finite,
}) {}

// The default lifetime cap: the maximum number of agent dispatches a single run
// may start before `ctx.agent` refuses with AgentLimitError. Overridable per
// process by the `__testHooks.agentLimit` seam (a small value keeps the lifetime
// test fast); inert at the default in production.
const DEFAULT_AGENT_LIMIT = 1_000

// The per-call batch cap for `ctx.parallel`/`ctx.pipeline` (Claude parity): a
// single call may carry at most this many tasks/items. Enforced with an explicit
// InvalidError AT THE CALL SITE so the author gets actionable feedback naming the
// offending call, instead of the batch silently degrading into a mass of `null`
// drops against the per-run lifetime cap above.
const MAX_BATCH_ITEMS = 4_096

// Framing directive prepended to every NON-schema agent step's prompt (Claude
// parity): a workflow step's final message is consumed by a PROGRAM (the step's
// resolved value), not by a human, so the subagent is told to output only the
// requested data. Prepended onto the prompt text exactly like the skills
// directive (PromptInput.system exists but the run loop's system-prompt assembly
// does not read it, so a prompt prepend is the supported mechanism). Schema steps
// are NOT framed: the StructuredOutput tool call enforces the shape already, and
// an extra "output only data" line could compete with the structured-output
// system prompt. Exported for tests asserting the dispatched prompt text.
export const STEP_FRAMING_DIRECTIVE =
  "You are one step of an automated workflow. Your final message is returned verbatim as this step's value to a program — output only the requested data, no preamble, no human-directed summary."

// Legitimate resume sources for `start({ resume_of })`. Beyond paused/interrupted,
// a FAILED source carries the core iteration loop (run fails → edit the script →
// replay the completed prefix live-free) and a COMPLETED source is the
// 100%-cache-hit re-run. `running` stays excluded (stop the source run first) and
// `cancelled` stays excluded (the cancel-of-a-paused-run race protection — see the
// status guard in start()).
const RESUMABLE: ReadonlySet<Status> = new Set(["paused", "interrupted", "failed", "completed"])

// The run-wide concurrency cap: the maximum number of `ctx.agent` dispatches that
// may run simultaneously within a single run, regardless of any (looser) per-call
// `concurrencyLimit`. Derived from the host's CPU count, clamped to [2, 16] so a
// tiny box never serializes to 1 and a huge box never fans out unbounded.
const agentConcurrencyCap = () => Math.min(16, Math.max(2, os.cpus().length - 2))

/**
 * Thrown by `checkpoint()` before the next `ctx.agent`/`ctx.parallel`/
 * `ctx.pipeline` task/step once the run's abort signal has fired, so the
 * follow-up step never starts. Detected in the run's failure branch and mapped
 * to `cancelled` rather than `failed`.
 *
 * Deliberately a plain `Error` (not `Schema.TaggedErrorClass`): it is thrown
 * synchronously from `checkpoint()`, a non-Effect JS callback invoked by the
 * workflow module's own code, so it cannot yield an Effect error.
 */
export class CancelledError extends Error {
  readonly _tag = "WorkflowCancelledError"
  constructor() {
    super("Workflow cancelled")
    this.name = "WorkflowCancelledError"
  }
}

// Item 15: sentinel resolved through the agent dispatch when a human skipped the
// step (skipAgent). The success settlement maps it to `null` WITHOUT touching
// the node — its `skipped` state was already persisted inside the dispatch gen.
// A module-scoped symbol so it can never collide with a real step result.
const SKIPPED = Symbol("workflow-agent-skipped")

export type AgentInput = {
  agent?: string
  prompt: string
  model?: string
  variant?: string
  tools?: Record<string, boolean>
  skills?: string[]
  files?: string[]
  schema?: Record<string, unknown>
  permissionSessionID?: SessionID
  /**
   * Explicit progress group for THIS call (Item 16). Pins the step's node to the
   * named phase regardless of where `ctx.setPhase` currently points — closing
   * the race window when setPhase and agent() do not share a microtask under
   * parallel/pipeline concurrency. A phase declared in `meta.phases` with a
   * `model` activates that model as this call's default (explicit `model` still
   * wins); the run's `current_phase` is NOT changed (no setPhase side effect).
   */
  phase?: string
  /** Display name for this step in run views (defaults to the agent name). */
  label?: string
  /**
   * Run this step's subagent in a FRESH `git worktree` instead of the run's
   * workspace, so parallel agents that mutate files do not conflict. The
   * worktree is created on first dispatch and auto-removed when the run finishes
   * or is cancelled (registered on the run scope). Requires the workspace to be
   * a git repository; otherwise the step fails with a WorkflowInvalidError.
   */
  isolation?: "worktree"
  /**
   * What a FAILING step resolves to (Item 15). Default `"fail"`: the error
   * propagates (run fails unless caught). `"null"`: the step resolves `null`
   * (the node stays `failed` with its error recorded) so the body can branch.
   * Budget/lifetime gates and aborts are NEVER swallowed — they always throw.
   */
  onError?: "fail" | "null"
}

// Pipeline/parallel option and stage shapes are the public workflow-authoring
// contract, owned by `@opencode-ai/plugin` (opencode depends on the plugin, so
// the plugin is the single source of truth). The engine re-exports them under
// its short names so workflow modules and the engine see the SAME types; any
// drift in the plugin definitions is a compile error here.
export type ParallelOptions = WorkflowParallelOptions
export type PipelineOptions = WorkflowPipelineOptions
export type PipelineStage<Prev, Item, Next> = WorkflowPipelineStage<Prev, Item, Next>
export type PipelineFn = WorkflowPipelineFn

export type ContextApi = {
  /** @deprecated USD-only view; prefer `ctx.budget.remaining()` (and `tokensRemaining()` for the token cap). */
  readonly budgetRemaining: number
  /**
   * Budget in Claude-Code API shape. USD: `total` (null when unlimited),
   * `spent()` so far, `remaining()` (Infinity when unlimited). Tokens (Item 17):
   * `tokensTotal`/`tokensSpent()`/`tokensRemaining()` — the same trio for the
   * independent output-token cap.
   */
  readonly budget: {
    readonly total: number | null
    spent(): number
    remaining(): number
    readonly tokensTotal: number | null
    tokensSpent(): number
    tokensRemaining(): number
  }
  readonly setPhase: (phase: string) => void
  readonly log: (message: string) => void
  readonly parallel: <T>(tasks: readonly (() => Promise<T>)[], options?: ParallelOptions) => Promise<(T | null)[]>
  readonly pipeline: PipelineFn
  /**
   * Resolves `null` when a human skips the step (skipAgent), or — with
   * `onError: "null"` — when the step fails (Item 15). Guard the result before
   * dereferencing (`if (!r) …`).
   */
  readonly agent: (input: AgentInput) => Promise<{ data: unknown; text: string } | null>
  /**
   * Deterministic non-LLM step: run a shell command in the run's workspace and
   * resolve to `{ output, exitCode }`. Does NOT consume an LLM turn or the run's
   * budget (`ctx.budget.spent()` is unaffected). A non-zero exit is mapped to the
   * returned `exitCode`, NOT thrown.
   */
  readonly shell: (
    command: string,
    opts?: { timeout?: number; cwd?: string },
  ) => Promise<{ output: string; exitCode: number }>
  /**
   * Run another DISCOVERED workflow inline under the SAME run (no separate run
   * row), sharing this run's concurrency, budget, abort scope, and agent-lifetime
   * cap. Returns the child workflow's `run()` result. Nesting is limited to depth
   * 1: a workflow invoked via `ctx.workflow` cannot itself call `ctx.workflow`
   * (the nested call throws a WorkflowInvalidError).
   */
  readonly workflow: (name: string, args?: Record<string, unknown>) => Promise<unknown>
  /**
   * Human-in-the-loop step (Tasks 12/13): persist a pending question on the run,
   * emit a `workflow.run.updated` event carrying `pending_question: true`, then
   * wait LIVE for an answer (a Deferred resolved by the service `answer()` method),
   * racing a timeout (default 10 minutes). On answer it resolves to `{ answer }`
   * and clears the pending question; the question is also recorded as a
   * `kind:"question"` journal node so a resumed run can replay the answer instead
   * of asking again. If the timeout elapses unanswered the run PARKS as `paused`
   * (the same pause machinery), keeping the open question so a later `answer()`
   * resumes it.
   */
  readonly question: (input: {
    question: string
    options?: readonly string[]
    timeout?: number
  }) => Promise<{ answer: string }>
}

// `ContextApi` is the engine-side view of the run context handed to a workflow
// module; `WorkflowContext` (plugin) is the public authoring view. They must
// stay structurally assignable so a value the engine builds is a valid argument
// to a module typed against the plugin. This is asserted at compile time rather
// than via a full SSoT import because the two differ intentionally: ContextApi
// is `readonly` and is the runtime producer, WorkflowContext is the consumer
// contract. Drift in either direction fails the build below.
type _ContextApiSatisfiesWorkflowContext = ContextApi extends WorkflowContext ? true : never
const _contextApiCheck: _ContextApiSatisfiesWorkflowContext = true
void _contextApiCheck

type Module = {
  meta: Meta
  run: (args: Record<string, unknown>, ctx: ContextApi) => Promise<unknown>
  // The RESOLVED module source string this module was loaded from — the file text
  // for an on-disk workflow, the bundled/inline string for a builtin/inline start.
  // loadModule already reads this to materialize the import; threading it out lets
  // start() stamp `definition.source` for EVERY run (not just inline starts), which
  // is what powers save-as-command and the run-detail source view.
  source: string
}

type Active = {
  run: Run
  /**
   * The workspace directory (InstanceState.directory) this run was started in.
   * Persisted to the `directory` column so every read/delete/sweep can be scoped
   * to the owning workspace (Fund 6/17): the DB is process-global but the
   * workflow endpoints are per-directory, so a run started in A must never leak
   * into / be swept from B. Not surfaced on the public `Run` schema — it is a
   * persistence/routing concern, not part of the run's reported shape.
   */
  directory: string
  done: Deferred.Deferred<Run>
  fiber?: Fiber.Fiber<void, unknown>
  /**
   * Per-run scope into which EVERY agent/parallel/pipeline effect is forked
   * (via `Effect.forkIn(runScope)`), instead of running as a detached root
   * fiber through `Effect.runPromise`. This makes all dispatched agent work a
   * tracked child of the run: closing `runScope` on cancel/remove propagates
   * Interrupt down to in-flight agent fibers (Fund 14), including ones that
   * started but had not yet registered their child session (Fund 16), and ones
   * that would otherwise re-INSERT a deleted row after delete (Fund 3). The
   * scope is forked from the instance scope, so an instance teardown also
   * closes it.
   */
  runScope: Scope.Closeable
  /** Child agent sessions currently in flight; aborted on cancel/remove. */
  sessions: Set<string>
  /** Session-abort vector for this run (the prompt-ops `cancel`); undefined when no prompt-ops were supplied. */
  cancelSession?: (sessionID: SessionID) => Effect.Effect<void>
  /** Set once a cancel/remove has been requested so the run finishes as `cancelled`, never `failed`. */
  cancelling?: boolean
  /**
   * Tombstone set by `remove()` BEFORE the row is deleted. `persistRun` reads
   * it inside its `Effect.suspend` and NO-OPs for a removed run, so a settlement
   * write racing the delete can never re-INSERT (resurrect) the deleted row
   * (Fund 3).
   */
  removed?: boolean
  /**
   * Original cost cap (USD) the run was started with, or `Infinity` when no
   * budget was set. Kept alongside `budgetRemaining` purely so the
   * BudgetExceededError can report how much was budgeted vs. spent.
   */
  budget: number
  /**
   * Live remaining budget (USD). Starts at `budget` and is decremented after
   * each agent step by that step's `AgentRun.cost`. `Infinity` ⇒ unlimited.
   * Read by `ctx.budgetRemaining`; gated against in `ctx.agent`.
   */
  budgetRemaining: number
  /**
   * Original cost cap (USD) the run was started with, or `undefined` when no
   * budget was set. Distinct from `budget` (which coerces "unset" to `Infinity`
   * for the gate): this keeps the unset case as `undefined` so `ctx.budget.total`
   * can report `null`. Read-only after `start()`.
   */
  budgetTotal?: number
  /**
   * Total cost (USD) actually spent so far, accumulated at the same site that
   * decrements `budgetRemaining` — but ALWAYS, even with no budget set, so
   * `ctx.budget.spent()` works regardless. Starts at 0. Read by `ctx.budget`.
   */
  costSpent: number
  /**
   * Output-token cap (Item 17), or `undefined` when no token budget was set
   * (unlimited). Gated in `ctx.agent` exactly like the USD cap — a soft cap with
   * the same audited parallel-overspend bound (comment T5).
   */
  tokensBudgetTotal?: number
  /**
   * Output tokens (output + reasoning; reasoning is output-billed) actually
   * spent so far. Accumulated at the SAME settlement site (and under the same
   * guards) as `costSpent` — ALWAYS, even with no token budget, so
   * `ctx.budget.tokensSpent()` works regardless. Starts at 0.
   */
  tokensSpent: number
  /**
   * Run-wide concurrency gate over EVERY `ctx.agent` dispatch (agent/parallel/
   * pipeline all funnel through ctx.agent). Sized to the host CPU count clamped
   * to [2, 16] at run start. A per-call `concurrencyLimit` still applies on top
   * (the narrower limit wins); this is the global ceiling for one run.
   */
  agentSemaphore: Semaphore.Semaphore
  /**
   * Count of agent dispatches STARTED by this run. Incremented at the top of
   * `ctx.agent`; once it would exceed `agentLimit` the call fails with
   * AgentLimitError so a runaway workflow cannot spawn unbounded subagents.
   */
  agentStarted: number
  /** Per-run lifetime ceiling (DEFAULT_AGENT_LIMIT unless overridden by the test seam). */
  agentLimit: number
  /** Set once pause() has requested suspension so the run finishes as `paused`, not `cancelled`/`failed`. */
  pausing?: boolean
  /**
   * Resume journal: when this run was started with `resume_of`, the source run's
   * completed agents keyed by call shape. Each `ctx.agent` consumes the next
   * unused entry for its key (occurrence order), so two identical calls resolve
   * to distinct journal entries. Absent on a non-resume run.
   */
  journal?: Map<string, AgentRun[]>
  /** Per-key consumption cursor into `journal`, advanced as each occurrence is replayed. */
  journalCursor?: Map<string, number>
  /**
   * Replay strategy of this resume (Item 20): `"prefix"` (default) walks
   * `journalSeq` in order and breaks permanently at the first mismatch;
   * `"keyed"` is the previous shape-matching behavior over `journal`/
   * `journalCursor`. Absent on a non-resume run.
   */
  journalMode?: "prefix" | "keyed"
  /**
   * Prefix-mode journal (Item 20): the source run's agents in ORIGINAL order
   * (questions filtered out — question replay stays on `questionJournal`),
   * INCLUDING non-completed nodes, which BREAK the prefix instead of being
   * invisibly absent. `index` is the node's position in the source `agents[]`
   * so `invalidate_agents` can be checked at replay time. Absent in keyed mode.
   */
  journalSeq?: { node: AgentRun; index: number }[]
  /** Consumption cursor into `journalSeq`, advanced on each prefix replay hit. */
  journalSeqCursor: number
  /**
   * Set once a prefix replay missed (changed call, non-completed source node,
   * invalidated index, or a schema parse failure). From then on EVERY
   * `ctx.agent` call runs live — the prefix is broken permanently (Item 20).
   */
  replayBroken: boolean
  /**
   * Prefix-mode view of `invalidate_agents` (source `agents[]` indices forced
   * live). Checked at replay time against `journalSeq[cursor].index`; a hit
   * breaks the prefix. Keyed mode filters these out at seed time instead.
   */
  invalidateSet?: Set<number>
  /** Id of the source run this run resumed from; mirrored onto `run.resume_of` and the row. */
  resumeOf?: RunID
  /**
   * The open human-in-the-loop question this run is currently parked on inside
   * `ctx.question` (Tasks 12/13). `deferred` is resolved by `answer()` on a LIVE
   * run to hand the reply back to the body; `node` is the `kind:"question"`
   * journal node so `answer()` can stamp the answer onto it. Set while a question
   * is awaited, cleared the instant it resolves (live) or times out (park).
   */
  pendingQuestion?: { deferred: Deferred.Deferred<{ answer: string }>; node: AgentRun }
  /**
   * Resume answer journal (Tasks 12/13): when this run resumed a source run that
   * was parked on a question, the answer supplied to `answer()` keyed by the
   * question node's call shape ([question, phase]). On reaching the matching
   * `ctx.question` the body is served this answer from the journal instead of
   * asking again — the SAME journal-replay seam the agent journal uses. Absent on
   * a run that did not resume a question.
   */
  questionJournal?: Map<string, string>
  /**
   * Per-phase DEFAULT model (Task 15). Resolved AT `setPhase` time from the
   * workflow's declared phases (`run.definition.meta.phases`) — the matched
   * phase's `model`, or `undefined` when the phase is undeclared or declares no
   * model. Stored here rather than re-parsed from `run.current_phase` so a nested
   * workflow's prefixed phase string never needs decoding: the value is set by the
   * SAME context's `setPhase`, and `ctx.agent` reads it as the middle tier of model
   * resolution (explicit input.model > this phase model > selected agent's model).
   */
  currentPhaseModel?: string
  /**
   * The caller session's RESOLVED model at start time (Item 12), captured by the
   * workflow tool via promptOps.currentModel. A DEFAULT-agent `ctx.agent` step
   * (no `agent:` override) with no explicit/phase model resolves to it, so
   * subagents follow the main loop's model. Absent on starts with no
   * session-model context (HTTP/programmatic). Shared by ctx.workflow children
   * automatically (same `active`).
   */
  callerModel?: { providerID: string; modelID: string }
  /**
   * Node IDs a human asked to skip via `skipAgent` (Item 15). Added BEFORE the
   * node's session is aborted (the same request-flag-first ordering cancel uses,
   * Fund 16) so the abort settlement can tell a skip apart from a cancel. The
   * step's ctx.agent call resolves `null` and the node finishes `skipped`.
   */
  skipRequests: Set<string>
  /**
   * Item 23 (Stufe 1): the bash permission ruleset every `ctx.shell` ask of
   * this run is evaluated against — the CALLER session's rules (deny/allow/
   * external_directory), inherited with the same logic as the subagent asks.
   * Computed once in start(); `[]` when there is no caller identity (HTTP/
   * headless start) — asks then fall through to the interactive default.
   */
  shellRuleset: PermissionV1.Rule[]
  /**
   * Item 24: the caller turn's shared budget pool (StartOptions.pool).
   * ctx.workflow children share `active`, so the pool is automatically shared;
   * a background run holds the reference past the turn's end. Per-step
   * reservations live in the step closure (not a map) — the step's `ensuring`
   * always settles them, so a reservation can never leak.
   */
  pool?: TurnBudget.Pool
}

type State = {
  runs: SynchronizedRef.SynchronizedRef<Map<string, Active>>
  scope: Scope.Scope
}

export interface Interface {
  // Never fails: a file that cannot be loaded is reported as an invalid Info
  // entry rather than aborting the whole list.
  readonly list: () => Effect.Effect<Info[]>
  /**
   * Resolves a single workflow's module SOURCE by name, for the pre-run approval
   * preview (which has no run yet, so it cannot read `run.definition.source`).
   * Returns the file text for an on-disk workflow or the bundled string for a
   * builtin — WITHOUT a raw `file.read({path})` (which failed for an absolute path
   * and returned "" for a synthetic `builtin:`/`inline:` marker). `list()` stays
   * lean (name + meta only); the heavier source is fetched on-demand only when the
   * operator actually opens the source view. Returns `undefined` for an unknown
   * name (the HTTP handler maps that to 404).
   */
  readonly read: (name: string) => Effect.Effect<Source | undefined>
  readonly runs: () => Effect.Effect<Run[]>
  readonly get: (id: RunID) => Effect.Effect<Run | undefined>
  readonly start: (input: StartOptions) => Effect.Effect<Run, InvalidError | NotFoundError>
  readonly wait: (input: WaitInput) => Effect.Effect<WaitResult>
  readonly cancel: (id: RunID) => Effect.Effect<Run | undefined>
  /**
   * Suspends a running run: aborts every tracked child agent session, closes the
   * run scope, and interrupts the run fiber (exactly like cancel), but finishes
   * the run with the non-terminal status `paused` instead of `cancelled` — the
   * persisted agent journal is kept intact so the run can later be resumed. Like
   * cancel, returns the run's snapshot, or `undefined` for a genuinely unknown id
   * (which the HTTP handler maps to 404). A run that is already terminal/paused is
   * returned as-is (idempotent); a non-live but persisted row is returned verbatim.
   */
  readonly pause: (id: RunID) => Effect.Effect<Run | undefined>
  /**
   * Skips ONE in-flight agent step of a LIVE run (Item 15): the step's
   * `ctx.agent` call resolves `null`, the node finishes `skipped` (no budget
   * charge), and the run continues. Returns `undefined` for an id unknown to
   * this workspace (HTTP → 404); fails with InvalidError when the run is not
   * live (no registry entry — a persisted/terminal run has nothing to skip),
   * the node does not exist, the node is a `question`, or the node is not
   * `running` (HTTP → 409). The skip request is recorded BEFORE the node's
   * session is aborted, mirroring cancel's request-flag-first ordering.
   */
  readonly skipAgent: (input: { id: RunID; agentId: string }) => Effect.Effect<Run | undefined, InvalidError>
  /**
   * Answers the open human-in-the-loop question on a run (Tasks 12/13):
   * - a LIVE run waiting in `ctx.question` → resolve the Deferred so the body
   *   receives `{ answer }`, clear the pending question, persist, and return the
   *   updated run.
   * - a `paused` run with a persisted `pending_question` → START a resume
   *   (`resume_of`) whose journal replay serves this answer to the question node
   *   instead of asking again, and return the NEW run.
   * - an unknown id, or a run with no open question → `undefined` (the HTTP
   *   mapping is a later track).
   */
  readonly answer: (input: AnswerInput) => Effect.Effect<Run | undefined, InvalidError | NotFoundError>
  /**
   * Persists a workflow SOURCE string to disk as a discoverable workflow file
   * (the dashboard's "save a run as a command"). Resolves the destination from
   * `scope`: `project` writes `<worktree|directory>/.opencode/workflows/<name>.ts`
   * (the same root discover() globs first), `global` writes
   * `<config>/workflows/<name>.ts`. The name is sanitized to a single safe path
   * segment (letters/digits/_/-) and the source is statically validated with the
   * SAME MetaReader the create tool uses (AST-only, never imports/executes the
   * module). NEVER overwrites: an existing file at the destination fails with
   * SaveConflictError. A bad name or invalid meta fails with InvalidError. Returns
   * the absolute path of the written file. Mirrors the create tool's write logic,
   * minus the tool-context permission ask (the HTTP route is gated by the auth
   * middleware; the engine method is the shared write seam for both surfaces).
   */
  readonly save: (input: SaveInput) => Effect.Effect<{ path: string }, InvalidError | SaveConflictError>
  /**
   * Exports a run's transcripts as hand-readable files under
   * `<data>/workflow/<runId>/transcripts/` (Item 27): `run.json` (the run
   * snapshot, 2-space) plus one `<agent-id>.jsonl` per agent node — each line
   * `{ info, parts }` for a message of the node's session, or a single
   * fallback line `{ node }` when the node has no readable session (a
   * replayed/cached node, a question node, or a deleted session), so the
   * export is always COMPLETE across all nodes. Idempotently overwrites on
   * re-export. Returns the directory and the written file names, or
   * `undefined` for a run unknown to this workspace (directory-scoped like
   * `get()`; the HTTP handler maps that to 404). A still-running run exports
   * its current snapshot. The JSONL line shape is a debug/hand format, NOT an
   * API contract — no schema is exported for it.
   */
  readonly export: (id: RunID) => Effect.Effect<{ path: string; files: string[] } | undefined>
  readonly remove: (id: RunID) => Effect.Effect<boolean>
  /**
   * Marks every `running` DB row that has no live registry entry as
   * `interrupted`. Runs automatically when the per-instance registry is first
   * created (process start → registry empty → all `running` rows are zombies),
   * and is exposed so callers/tests can trigger it explicitly. Paused rows are
   * deliberately left untouched (parked by design, not lost).
   */
  readonly sweep: () => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/Workflow") {}

const decodeMeta = Schema.decodeUnknownExit(Meta)

// Cross-version phases compatibility (@VasyaYovbak). The `definition` JSON column
// is the one place the phases shape drifted between branches: an older branch
// stored `meta.phases` as bare strings (`["setup"]`), a newer one as normalized
// objects (`[{title:"setup"}]`). Switching branches leaves the OTHER shape's rows
// in the shared local DB. Two halves close the gap, both routed through the SAME
// `Definition`/`Meta` schema whose `phases` union (`string | object`) already
// accepts BOTH shapes:
//
// (A) PERSIST writes the back-compat ENCODED form. `encodeDefinitionForRow`
//     re-emits a title-only phase as the bare STRING (a structured phase stays an
//     object) so an OLDER reader expecting `phases: string[]` can still decode our
//     plain-phase rows. Only `meta.phases` is rewritten — a targeted, total
//     transform — instead of a full `Schema.encode(Definition)` round-trip, which
//     would needlessly re-run the codec over `source`/`path` and risk throwing on
//     a definition that drifted; the bytes for every OTHER field are untouched.
//
// (B) READ normalizes back to the canonical OBJECT form. `decodeDefinition` runs
//     the stored definition through the schema decode (the union accepts strings
//     OR objects), so the in-memory `Run` is ALWAYS object-phased and the public
//     `Run` encode (the HTTP response) never trips over a string phase producing
//     an `undefined` title — the exact failure the reviewer reported.
const decodeDefinition = Schema.decodeUnknownExit(Definition)

// (A) Persist-time encode: return a row-shaped definition whose `meta.phases` is
// the back-compat WIRE form. Total and field-local — we touch only `meta.phases`
// and leave every other field (name/path/source/temporary, all other meta keys)
// byte-identical, so this can never throw on a well-formed in-memory definition.
function encodeDefinitionForRow(definition: Definition): Definition {
  if (!definition.meta.phases) return definition
  return {
    ...definition,
    meta: { ...definition.meta, phases: definition.meta.phases.map(encodePhase) as Definition["meta"]["phases"] },
  }
}

// (C) De-dupe seam: a persistently-bad row would otherwise re-warn on EVERY
// runs()/get() (every dashboard poll re-reads it), so a single foreign row would
// spam the log forever. Warn at most ONCE per row id per process — a plain
// module-level Set keyed by id, which is total and never unbounded in practice
// (one entry per distinct bad row, which is a tiny finite set). Lives at module
// scope (not per-instance) deliberately: the warn is a developer diagnostic, not
// per-workspace state, so once-per-process is the right granularity.
const warnedBadDefinitionRows = new Set<string>()

// (B)+(C) Read-time normalize with per-row resilience. Decode the stored
// definition so its phases land in the canonical object form regardless of
// whether the row holds strings (old/encoded) or objects (older un-encoded
// rows). A row whose definition the schema REJECTS (a foreign/malformed shape
// from some other branch) is COERCED — not dropped — to a safe definition with
// EMPTY phases: a corrupt phases blob must never blank a user's run out of the
// history list, so we degrade that one field and keep the row's id/status/logs
// visible. (Skipping the row was the alternative; coercing is the friendlier
// graceful-degradation choice — the run still shows up, just without phases.)
//
// `runId` is threaded in only to de-dupe the warn (see above); it is not part of
// the normalization itself, so it is optional (a caller without a row id — none
// today — simply warns every time, which is the old behavior).
function normalizeDefinition(definition: Definition | undefined, runId?: string): Definition | undefined {
  if (definition === undefined) return undefined
  const decoded = decodeDefinition(definition)
  if (Exit.isSuccess(decoded)) return decoded.value as Definition
  // Diagnostic only — never rethrow: the whole point of (C) is that ONE bad row
  // cannot fail the list/get response; we COERCE the row (keep it, degrade its
  // phases to empty) rather than drop it. `console.warn` (not an Effect logger)
  // because this is a pure, synchronous row-mapping helper outside any fiber.
  // De-duped per row id so a persistently-bad row warns once, not on every poll.
  if (runId === undefined || !warnedBadDefinitionRows.has(runId)) {
    if (runId !== undefined) warnedBadDefinitionRows.add(runId)
    console.warn(
      `[workflow] coercing un-decodable definition phases to empty for "${definition.name}": ${Cause.pretty(decoded.cause)}`,
    )
  }
  return { ...definition, meta: { ...definition.meta, phases: [] } }
}

// N13: the public `Run` projection of a live run. The spread copies ONLY the
// `Run` fields (`active.run` is exactly the `Run` shape — the engine-internal
// fields like `directory`/`runScope`/`budget` live on `Active`, never on
// `active.run`), so no internal state leaks. But a shallow spread still ALIASES
// the live nested values, so a caller mutating `snapshot(active).args.x` /
// `.definition` / `.result` / a `logs`/`agents`/`agents[].tokens` entry would
// mutate the running engine's own state. Defensively deep-copy every nested
// value so the returned run is a detached projection (matching `fromRow`, which
// already returns a fresh DB-parsed run).
//
// The clone goes through the JSON codec (`JSON.parse(JSON.stringify(x))`) — the
// SAME serializability semantics as `persistRun`/`fromRow`, which round-trip the
// JSON columns. structuredClone (the previous approach) was wrong: it THROWS on
// functions/symbols/class instances (`DOMException: object can not be cloned`),
// which a workflow can return via `result` (e.g. `return { cb: () => {} }`), so
// it stranded every no-timeout `wait()` and blocked the terminal persist (N2
// regression). The JSON codec instead drops those values silently, exactly as
// the DB persist does, keeping the live snapshot and the DB row identical.
//
// This is total — it cannot throw — for every reachable engine state: `args`/
// `definition` are `mode: "json"` columns (a non-JSON value would already have
// died at the persist that ran on `start`), and `result` is JSON-normalized at
// the single point it enters the engine (the `finish` boundary, see below), so
// by the time it lands on `active.run.result` it is guaranteed JSON-safe. The
// per-entry JSON clone of `agents` also severs the `tokens`/`cache` aliasing
// (those are plain numbers, never throw).
function jsonClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value))
}

function snapshot(active: Active): Run {
  return {
    ...active.run,
    args: active.run.args === undefined ? undefined : jsonClone(active.run.args),
    definition: active.run.definition === undefined ? undefined : jsonClone(active.run.definition),
    result: active.run.result === undefined ? undefined : jsonClone(active.run.result),
    logs: active.run.logs.map((item) => ({ ...item })),
    agents: active.run.agents.map((item) => jsonClone(item)),
    // Detach the pending question from the live run so a caller mutating the
    // returned snapshot cannot reach into engine state (mirrors the nested-value
    // defensiveness above). `options` is a plain string array, JSON-safe.
    pending_question: active.run.pending_question === undefined ? undefined : jsonClone(active.run.pending_question),
  }
}

type Row = typeof WorkflowRunTable.$inferSelect

function fromRow(row: Row): Run {
  return {
    // DB->engine brand boundary: the row id is an opaque `text` column in core
    // (which cannot import the engine's brand), so it is re-branded here.
    id: RunID.make(row.id),
    session_id: row.session_id ?? undefined,
    workflow: row.workflow,
    args: row.args ?? undefined,
    // (B)+(C): normalize the stored definition's phases to the canonical OBJECT
    // form (the row may hold the old string shape from another branch) and
    // coerce — never throw — if the definition is foreign/un-decodable, so one
    // bad row never blanks the whole list/get response (@VasyaYovbak). The row id
    // is passed so a persistently-bad row's coerce-warn is de-duped per id.
    definition: normalizeDefinition(row.definition ?? undefined, row.id),
    status: row.status,
    started_at: row.started_at,
    completed_at: row.completed_at ?? undefined,
    current_phase: row.current_phase ?? undefined,
    logs: row.logs.map((item) => ({ ...item })),
    agents: row.agents.map((item) => ({ ...item })),
    // Fund 42: the `result` column is plain JSON text (the engine owns the codec,
    // see persistRun). SQL NULL means the result was never recorded → `undefined`;
    // any stored text is JSON-parsed, so the literal `"null"` decodes back to the
    // real `null` a workflow returned rather than being flattened to `undefined`.
    result: row.result === null ? undefined : JSON.parse(row.result),
    error: row.error ?? undefined,
    // DB->engine brand boundary: the source-run id is an opaque `text` column in
    // core; re-brand it here like the row id above. Nullable column → undefined.
    resume_of: row.resume_of ? RunID.make(row.resume_of) : undefined,
    // The open question (Tasks 12/13). A `mode: "json"` column, so the driver has
    // already parsed it to an object (or SQL NULL → JS null → undefined here). The
    // shape mirrors the engine schema; `options` is copied so the engine value is
    // detached from the row's array.
    pending_question: row.pending_question
      ? {
          question: row.pending_question.question,
          options: row.pending_question.options ? [...row.pending_question.options] : undefined,
          asked_at: row.pending_question.asked_at,
        }
      : undefined,
  }
}

// Test seam (N2): when set, the NEXT terminal persist (the awaited write in
// `finish`) fails once, simulating a DB error on the terminal write. Used only
// by the workflow test to prove that a failing terminal persist never strands
// the run's `done` deferred (waiters must still observe the terminal state).
// A module-level one-shot flag is the minimal seam that does not require
// threading a fake DB through the whole layer graph; it is inert in production.
let failNextTerminalPersist = false
// Test seam: overrides the per-run agent lifetime cap (DEFAULT_AGENT_LIMIT) for
// runs started AFTER this is called, so the lifetime test can prove the gate with
// a tiny limit (e.g. 5) instead of dispatching 1.000 agents. `undefined` ⇒ the
// default. Inert in production (never called). Captured per-run at start().
let agentLimitOverride: number | undefined
// Instance-aware test seam (Finding 10): set inside the layer once `state` exists.
// Lets a test flip a live run's `pausing` flag exactly as `abortRun(active,"pause")`
// does synchronously — reproducing the narrow window where a run is unwinding to
// paused but its open question is still live — without racing the real scope close.
let setPausingHook: ((id: string) => Effect.Effect<boolean>) | undefined
// Finding 4 test seam: an Effect the question() dispatch runs the instant the
// timeout wins (`None`) but BEFORE the park decision — while `pendingQuestion` is
// still live — so a test can deterministically land an answer() in the
// timeout-vs-answer race window. `Effect.void` in production (no-op).
let questionTimeoutParkHook: Effect.Effect<unknown> = Effect.void
// Finding 2 test seam: records the live spend accumulators (`budgetRemaining` /
// `costSpent`) of each run AS IT REACHES its terminal transition in finish().
// These are in-memory `active` fields that are never persisted to the row, so a
// test cannot read them back after the run is evicted; this captures them at the
// exact moment the run settles. Inert in production (never set).
let captureSpendHook: ((id: string, spend: { budgetRemaining: number; costSpent: number }) => void) | undefined
export const __testHooks = {
  failNextTerminalPersist: () => {
    failNextTerminalPersist = true
  },
  agentLimit: (limit: number) => {
    agentLimitOverride = limit
  },
  /**
   * Flip the live registry entry's `pausing` flag for `id`, mirroring the first
   * synchronous step of `pause()`/`abortRun`. Returns `true` if a live entry was
   * found and flipped. Used to deterministically drive Finding 10's race.
   */
  setPausing: (id: string): Effect.Effect<boolean> => (setPausingHook ? setPausingHook(id) : Effect.succeed(false)),
  /**
   * Register an Effect to run once inside the question() timeout-park window
   * (Finding 4). It fires while the open question is still live in-memory, so a
   * test can call answer() there to reproduce the timeout-vs-answer race
   * deterministically. The hook auto-clears after firing so it runs at most once.
   */
  runOnQuestionTimeoutPark: (effect: Effect.Effect<unknown>) => {
    questionTimeoutParkHook = effect.pipe(
      Effect.ensuring(
        Effect.sync(() => {
          questionTimeoutParkHook = Effect.void
        }),
      ),
    )
  },
  /**
   * Capture the live spend accumulators (`budgetRemaining`/`costSpent`) of each
   * run as it settles in finish(). Used by Finding 2's test to prove an
   * externally-aborted subagent's abort-artifact cost is NOT charged to the
   * budget even though the run terminates `cancelled`.
   */
  captureSpend: (sink: (id: string, spend: { budgetRemaining: number; costSpent: number }) => void) => {
    captureSpendHook = sink
  },
  /**
   * Run the startup worktree sweep against `directory` (Item 7). Lets a test
   * prove the preserved-marker / dirty-tree skip directly, without forcing a
   * full instance-state re-materialization.
   */
  sweepWorktrees: (directory: string): Promise<void> => sweepWorktrees(directory),
}

class TerminalPersistTestError extends Error {
  constructor() {
    super("injected terminal persist failure (test seam)")
  }
}

// The terminal run statuses: a run in one of these has settled and will never
// transition again, so its persist emits `workflow.run.finished` instead of
// `workflow.run.updated`. `running`/`paused` are the only non-terminal statuses
// (a paused run can still resume), so they emit `updated`. This mirrors the
// terminal/non-terminal split documented on the `Status` literal above.
const TERMINAL_STATUSES = ["completed", "failed", "cancelled", "interrupted"] as const
function isTerminalStatus(status: string): boolean {
  return (TERMINAL_STATUSES as readonly string[]).includes(status)
}

function persistRun(
  db: Database.Interface["db"],
  events: EventV2Bridge.Service["Service"],
  active: Active,
  options?: { terminal?: boolean },
) {
  // The snapshot MUST be built at execution time (inside Effect.suspend), not
  // at effect-construction time: progress writes are forked into the run scope
  // and may execute AFTER the awaited terminal write in `finish`. A snapshot
  // captured at construction would then revert the row to a stale state
  // (live-found regression: a completed run's row flipped back to `running`).
  // Reading `active.run` at execution time makes every write a full snapshot of
  // the CURRENT state, so any write ordering converges on the final row.
  return Effect.suspend(() => {
    // Fund 3: once a run is removed, NO write may re-create its row. A late
    // settlement write (a detached agent that settles after `remove` deleted
    // the row) would otherwise re-INSERT a zombie row, only swept to
    // `interrupted` on the next restart. The tombstone is checked at execution
    // time so it covers writes already queued before the delete.
    if (active.removed) return Effect.void
    // Test seam (N2): fail exactly the terminal write once, to prove the
    // `done` deferred still resolves around a failing terminal persist.
    if (options?.terminal && failNextTerminalPersist) {
      failNextTerminalPersist = false
      return Effect.fail(new TerminalPersistTestError())
    }
    const data = {
      id: active.run.id,
      session_id: active.run.session_id ?? null,
      directory: active.directory,
      workflow: active.run.workflow,
      status: active.run.status,
      started_at: active.run.started_at,
      completed_at: active.run.completed_at ?? null,
      current_phase: active.run.current_phase ?? null,
      args: active.run.args ?? null,
      // (A): persist the definition with its phases in the back-compat WIRE form
      // (a title-only phase → the bare string), so an OLDER reader whose schema
      // expects `phases: string[]` can still decode our rows (@VasyaYovbak). Only
      // `meta.phases` is rewritten; `snapshot()` still returns the normalized
      // OBJECT form, so only the PERSISTED bytes change. The cast threads the
      // back-compat string|object phases past the row type (whose `phases` is
      // typed as objects only); on READ `normalizeDefinition` decodes it back.
      definition: active.run.definition
        ? (encodeDefinitionForRow(active.run.definition) as unknown as WorkflowDefinitionRow)
        : null,
      logs: active.run.logs,
      agents: active.run.agents,
      // Fund 42: the `result` column is plain text and the engine owns its JSON
      // codec, so a real `null` result survives the roundtrip distinct from an
      // unset one. An unset result (`undefined`) is stored as SQL NULL; any other
      // value — including the literal `null` a workflow may return — is stringified
      // to JSON text (a `null` result becomes the text `"null"`, NOT SQL NULL).
      result: active.run.result === undefined ? null : JSON.stringify(active.run.result),
      error: active.run.error ?? null,
      resume_of: active.run.resume_of ?? null,
      // The open question (Tasks 12/13). Persisted as a JSON object so a paused
      // run that timed out keeps it across restarts; `undefined` ⇒ SQL NULL (no
      // pending question). `options` is normalized to a mutable array for the row
      // type (the engine schema declares it `readonly`).
      pending_question: active.run.pending_question
        ? {
            question: active.run.pending_question.question,
            options: active.run.pending_question.options ? [...active.run.pending_question.options] : undefined,
            asked_at: active.run.pending_question.asked_at,
          }
        : null,
    }
    return db
      .insert(WorkflowRunTable)
      .values(data)
      .onConflictDoUpdate({
        target: WorkflowRunTable.id,
        set: { ...data, time_updated: Date.now() },
      })
      .run()
      .pipe(
        // Publish the run-lifecycle event ONLY after the upsert commits, so a
        // consumer never observes a state that was not persisted. Sits inside the
        // write path so it inherits the `active.removed` tombstone and the failing
        // terminal-persist seam above (both return before reaching here ⇒ no
        // publish). The event is chosen by terminal status, never by the caller's
        // `terminal` flag, so any persist that happens to carry a terminal status
        // (e.g. a forked progress write that races the awaited terminal one) still
        // reports `finished` consistently. Slim payload — counts, not the arrays.
        Effect.tap(() =>
          events.publish(isTerminalStatus(active.run.status) ? Event.Finished : Event.Updated, {
            id: active.run.id,
            workflow: active.run.workflow,
            status: active.run.status,
            current_phase: active.run.current_phase ?? null,
            directory: active.directory,
            agents: {
              total: active.run.agents.length,
              running: active.run.agents.filter((a) => a.status === "running").length,
              failed: active.run.agents.filter((a) => a.status === "failed").length,
            },
            pending_question: active.run.pending_question !== undefined,
            error: active.run.error ?? null,
          }),
        ),
      )
  }).pipe(Effect.orDie)
}

/**
 * Forks a progress-snapshot write as a child of the run scope, so the fiber is
 * tracked and torn down with the run (and, transitively, the instance) instead
 * of leaking as a detached root fiber. Interrupt-on-dispose is safe for these
 * writes: every `persistRun` is an idempotent full-state upsert that NO-OPs for
 * a removed run, the terminal write in `finish` is awaited inline, and the
 * startup orphan sweep heals any run whose last progress snapshot was cut short.
 */
function persistInScope(
  active: Active,
  bridge: EffectBridge.Shape,
  db: Database.Interface["db"],
  events: EventV2Bridge.Service["Service"],
) {
  bridge.fork(persistRun(db, events, active).pipe(Effect.forkIn(active.runScope)))
}

/**
 * Rewrites every `running` row whose id is not in `liveIds` to `interrupted`
 * with a completion timestamp, AND normalizes any still-`running` agent node in
 * those rows to `failed` (Fund 15). Used by the startup sweep (liveIds empty) and
 * the exposed `sweep()` method (liveIds = currently active runs); genuinely-
 * running rows owned by a live fiber are left untouched.
 *
 * Fund 15: a swept orphan has no live registry entry, so the only node-closeout
 * (in finish()) never runs for it — the row used to keep agents with status
 * `running`, no completed_at, no error, and the TUI then rendered a live agent
 * icon forever on a terminal run. The sweep now patches the agents JSON too: each
 * `running` node becomes `failed` with the sweep time and an explanatory error.
 *
 * The run-level flip is no longer a single bulk UPDATE because the agents JSON is
 * per-row (each row's array is patched in JS), so the bulk write degrades to a
 * select + per-row update. Both the read and the writes run inside ONE
 * transaction so the orphan set the sweep acts on cannot change underneath it
 * (a row flipping to running/terminal between the read and the write) and the
 * whole heal commits atomically.
 *
 * `directory` scopes the sweep to the calling workspace (Fund 17): the DB is
 * process-global but every per-directory registry only knows its OWN runs, so a
 * sweep keyed off another directory's (empty) registry must NOT flip a run that
 * is genuinely live in a different workspace. Without the scope, the first
 * Workflow operation in a second directory B — whose fresh registry is empty —
 * would stamp every `running` row of every directory (including a run currently
 * executing in A) to `interrupted`.
 */
function sweepOrphans(db: Database.Interface["db"], liveIds: ReadonlySet<string>, now: number, directory: string) {
  const where = and(
    eq(WorkflowRunTable.status, "running"),
    eq(WorkflowRunTable.directory, directory),
    liveIds.size ? notInArray(WorkflowRunTable.id, [...liveIds]) : undefined,
  )
  return db
    .transaction((tx) =>
      Effect.gen(function* () {
        const orphans = yield* tx
          .select({ id: WorkflowRunTable.id, agents: WorkflowRunTable.agents })
          .from(WorkflowRunTable)
          .where(where)
          .all()
        yield* Effect.forEach(
          orphans,
          (orphan) =>
            tx
              .update(WorkflowRunTable)
              .set({
                status: "interrupted",
                completed_at: now,
                time_updated: now,
                agents: orphan.agents.map((node) =>
                  node.status === "running"
                    ? { ...node, status: "failed", completed_at: now, error: "interrupted: process restarted" }
                    : node,
                ),
              })
              .where(eq(WorkflowRunTable.id, orphan.id))
              .run(),
          { discard: true },
        )
      }),
    )
    .pipe(Effect.orDie, Effect.asVoid)
}

function errorText(error: unknown) {
  if (APICallError.isInstance(error)) {
    return [error.message, error.statusCode ? `status: ${error.statusCode}` : undefined, error.responseBody]
      .filter(Boolean)
      .join("\n")
  }
  if (error instanceof Error) return error.message
  return String(error)
}

function isInvalidError(error: unknown): error is InvalidError {
  return typeof error === "object" && error !== null && Reflect.get(error, "_tag") === "WorkflowInvalidError"
}

function isCancelled(value: unknown): boolean {
  return (
    value instanceof CancelledError ||
    (typeof value === "object" && value !== null && Reflect.get(value, "_tag") === "WorkflowCancelledError")
  )
}

// Fund 4: the production session runner RESOLVES a prompt on abort (it returns
// the last assistant message rather than rejecting), and that message carries
// an abort marker — either an `aborted` flag or a `MessageAbortedError` error
// (see message-v2.ts `fromError` / v1 `AbortedError`). An agent step whose
// prompt came back abort-marked did NOT succeed and must be treated as
// cancelled, never flipped to `completed`. Tolerant of the loose `WithParts`
// shape the engine sees (it only reads `info`).
function isAbortedMessage(message: SessionV1.WithParts): boolean {
  const info = message.info as { aborted?: boolean; error?: { name?: string } } | undefined
  if (!info) return false
  if (info.aborted === true) return true
  const name = info.error?.name
  return name === "MessageAbortedError" || name === "AbortError"
}

// Enforces the workflow's DECLARED argument contract (meta.arguments) at the
// single engine entry point — `start()`, before `module.run` — so every start
// path (HTTP JSON args, the workflow tool, the TUI) gets identical, authoritative
// behavior regardless of what the UI did upstream. Two concerns, in order:
//
//   1. Defaults: a declared `default` fills in any argument the caller omitted.
//      An explicitly supplied value always wins over the default. Either way the
//      value (supplied OR default) is run through the SAME coercion below, so a
//      `default: "7"` for a number-declared arg reaches run() as the number 7,
//      consistent with the authoritative type contract.
//   2. Coercion to the declared `type`:
//      - number: a numeric string ("42") becomes the number 42; the result must
//        be finite, so "abc"/"Infinity" and a non-string/non-number (null,
//        object, boolean) fail with InvalidError. Strings are trimmed first and
//        an empty / whitespace-only string is rejected — `Number("")` and
//        `Number("  ")` are 0 (finite!), which would silently swallow a missing
//        value as 0; we treat those as InvalidError instead. We deliberately keep
//        the full `Number()` parse semantics for the remaining strings, which
//        means hex ("0x10" -> 16) and exponent ("1e3" -> 1000) are accepted; for
//        JSON/HTTP-shaped numbers this is the least-surprising choice and stays
//        consistent with the rest of the numeric path. A value already a number
//        is kept as-is.
//      - boolean: only the strings "true"/"false" (or an actual boolean) are
//        accepted; anything else fails with InvalidError.
//      - string: a primitive non-string (number/boolean) is coerced via
//        String(...). A non-primitive (object/array) is left UNCHANGED — there is
//        no honest String() for it and forcing "[object Object]" would hide a
//        caller mistake.
//
// An argument with NO declared type, or one not declared in meta.arguments at
// all, is passed through verbatim. Returns the coerced map (or undefined when
// the caller passed none and there are no defaults to apply), or an InvalidError
// naming the offending argument.
function coerceArgs(
  args: Record<string, unknown> | undefined,
  declared: Meta["arguments"],
  path: string,
): Record<string, unknown> | undefined | InvalidError {
  if (!declared) return args
  const supplied = args ?? {}
  const result: Record<string, unknown> = { ...supplied }
  for (const [name, argument] of Object.entries(declared)) {
    // Supplied value wins; otherwise fall back to the declared default. Both go
    // through the identical coercion below — a value present at all (supplied or
    // defaulted) is coerced to the declared type before run() ever sees it.
    const hasValue = name in supplied
    if (!hasValue && argument.default === undefined) continue
    const value = hasValue ? supplied[name] : argument.default
    if (argument.type === "number") {
      // Trim strings first, then reject the empty trim explicitly: `Number("")`
      // and `Number("  ")` are 0 (finite) and would otherwise swallow a blank
      // input as 0. Non-string/non-number values short-circuit to NaN -> error.
      const trimmed = typeof value === "string" ? value.trim() : value
      const coerced =
        typeof trimmed === "number" ? trimmed : typeof trimmed === "string" && trimmed !== "" ? Number(trimmed) : NaN
      if (!Number.isFinite(coerced))
        return new InvalidError({
          path,
          message: `argument "${name}" must be a finite number, got ${JSON.stringify(value)}`,
        })
      result[name] = coerced
      continue
    }
    if (argument.type === "boolean") {
      const coerced =
        typeof value === "boolean" ? value : value === "true" ? true : value === "false" ? false : undefined
      if (coerced === undefined)
        return new InvalidError({
          path,
          message: `argument "${name}" must be a boolean ("true"/"false"), got ${JSON.stringify(value)}`,
        })
      result[name] = coerced
      continue
    }
    if (argument.type === "string" && typeof value !== "string") {
      // Only primitive non-strings get a String() coercion; objects/arrays are
      // left untouched (no honest string form — see the doc comment above).
      if (typeof value === "number" || typeof value === "boolean") result[name] = String(value)
      continue
    }
    // No declared type, or value already matches it: pass through unchanged.
    // (Default-only path still records the default verbatim here.)
    if (!hasValue) result[name] = value
  }
  return result
}

function mutableMeta(meta: Meta): Definition["meta"] {
  return {
    name: meta.name,
    description: meta.description,
    // Phases are normalized objects (Task 15); deep-copy each so the mutable
    // Definition does not alias the (readonly) decoded meta's phase objects.
    phases: meta.phases ? meta.phases.map((phase) => ({ ...phase })) : undefined,
    arguments: meta.arguments
      ? Object.fromEntries(Object.entries(meta.arguments).map(([name, argument]) => [name, { ...argument }]))
      : undefined,
  }
}

// Resume journal key: identifies a `ctx.agent` call by its dispatch shape so the
// same call in a resumed run lands on the same source-run agent. A stable JSON
// tuple with `null` for absent fields, so calls differing only in (say) phase get
// distinct keys. Two IDENTICAL calls produce the SAME key; the occurrence cursor
// (journalCursor) then keeps them separate in call order — the first such call
// replays the first matching source agent, the second the next one.
//
// Built from the RESOLVED agent name (not the raw `AgentInput.agent`) on both
// sides: a source agent's persisted `node.agent` is the engine-normalized
// `selected.name`, so the lookup must resolve the live call the SAME way (default
// agent → its name) to match. `model` and `schema` are deliberately NOT part of
// the key: the persisted node normalizes `model` to the actually-used model id
// (which a fresh resolve cannot reproduce) and never stores the requested
// `schema` at all, so including either would make a default-model or structured
// call fail to match and re-run live. The key therefore matches on the stable,
// reconstructible fields [prompt, resolvedAgent, phase]; the lookup's own schema
// presence still drives how the replayed output is interpreted at replay time.
//
// `label` (Item 16) is deliberately NOT part of the key: it is display-only, so
// relabeling a step between runs must not invalidate its journal entry. A per-call
// `phase` (Item 16) needs no special handling — both the seed side and the live
// lookup key on `node.phase`, which carries the (prefixed) per-call phase, so a
// pinned step is automatically resume-stable.
function journalKey(parts: { prompt: string; agent?: string; phase?: string }): string {
  return JSON.stringify([parts.prompt, parts.agent ?? null, parts.phase ?? null])
}

// Resume journal key for a `ctx.question` node (Tasks 12/13). The question has no
// agent/model/schema, so it keys purely on [kind:"question", question, phase] —
// the question text plus the phase it was asked in. The literal "question" tag
// keeps the namespace disjoint from agent keys even if a prompt happened to equal
// a question. Built identically on the seed side (from the source run's question
// node) and the live side (the re-asked question), so a resumed run resolves the
// answer from the journal instead of asking again.
function questionJournalKey(parts: { question: string; phase?: string }): string {
  return JSON.stringify(["question", parts.question, parts.phase ?? null])
}

// The default wait for a `ctx.question` with no explicit `timeout` (Tasks 12/13):
// 10 minutes. Once it elapses with no answer the run PARKS as `paused` (existing
// pause machinery) with the open question persisted, so a later `answer()` can
// resume it. Tests pass a tiny timeout to exercise the park path quickly.
const DEFAULT_QUESTION_TIMEOUT_MS = 10 * 60 * 1000

// loadModule writes a transient import copy ALONGSIDE the source file (same
// directory) on purpose: relative imports and the workflow module's
// node_modules resolution are anchored on the source directory, so moving the
// copy to os.tmpdir() would break module resolution. The trade-off is that a
// process killed mid-import can leave the temp copy behind — hence the orphan
// filter + sweep in discover() below, which keys off TEMP_FILE_RE.
//
// The name shape is `.<base>.<ts>.<rand>.<mts|mjs>`: a leading dot (hidden),
// the original base name, a millisecond timestamp (used by the sweep to age the
// file out), a random suffix (collision-free concurrent loads), and an .mts/.mjs
// extension that is deliberately NOT one of the discovered globs (`*.ts`/`*.js`),
// so a temp copy can never be picked up as a workflow even before the sweep runs.
const TEMP_FILE_RE = /^\.(.+)\.(\d+)\.[0-9a-f]+\.(mts|mjs)$/
const TEMP_FILE_MAX_AGE_MS = 60 * 60 * 1000

// Finding 3: per-step worktree isolation mints a private base dir via
// `fs.mkdtemp(os.tmpdir()/oc-wf-…)`. The run-scope finalizer removes it on a
// normal finish/cancel, but a SIGKILL/crash mid-run never fires that finalizer,
// leaking the checked-out repo content (and any secrets the subagent wrote) into
// tmp indefinitely. A best-effort startup sweep (mirroring sweepTempFiles)
// reclaims stale `oc-wf-*` worktrees older than the cutoff so a crashed process
// does not leave repo content behind. The prefix is shared with the creation site
// so the sweep matches exactly the dirs the engine mints.
const WORKTREE_PREFIX = "oc-wf-"
const WORKTREE_MAX_AGE_MS = 60 * 60 * 1000
// Item 7: marker file the run-scope finalizer writes into a worktree it
// deliberately PRESERVES (uncommitted changes / new commits). The startup sweep
// skips dirs carrying it — otherwise a preserved worktree would be silently
// deleted one hour later by the orphan sweep.
const WORKTREE_PRESERVED_MARKER = ".oc-wf-preserved"

function tempFileName(file: string): string {
  const ext = path.extname(file)
  return `.${path.basename(file, ext)}.${Date.now()}.${Math.random().toString(16).slice(2)}${ext === ".js" ? ".mjs" : ".mts"}`
}

// Each call imports the file fresh through a unique temp-file copy, so a
// workflow edited between calls is always reloaded. We deliberately do NOT keep
// a cross-call module cache, and we do not rely on a `?mtime=` query either:
// Bun's module cache is not reliably invalidated by a query string alone, so a
// cached or query-busted import can serve a stale `run`/`meta` after an edit
// (the realtime-update bug). Correctness over micro-optimization — the
// double-load that motivated the original finding is already gone because
// start() now loads only the target module instead of calling list().
// `inlineSource`, when given, is the module SOURCE of a workflow that has no real
// file on disk — its `file` is a synthetic scheme marker (`builtin:<name>` for a
// bundled builtin, `inline:<metaName>` for a P3 inline-source start), not a real
// path. The marker has no source directory, so the temp copy is written into the
// GLOBAL workflows directory (`<Global.Path.config>/workflows`) rather than
// `import.meta.dir`: in a compiled Bun binary `import.meta.dir` is `/$bunfs/root`
// (read-only — writing there throws ENOENT), whereas the global config dir is
// a binary-proven writable location where normal global workflows already load
// from. Builtin sources are SELF-CONTAINED by invariant (no imports — see
// builtin.ts); an inline source is authored by the model/user and likewise
// materialized here, so the temp copy depends on no node_modules above it and
// loads identically in dev and in the binary. The directory is ensured (the
// workflows subdir may not exist on a cold system) and the temp file keeps
// TEMP_FILE_RE's name shape so the per-directory sweep in discover() cleans up any
// orphan; the random temp suffix means two concurrent inline starts never collide.
// A write failure is a hard error (there is no original file to fall back to).
async function loadModule(file: string, inlineSource?: string): Promise<Module> {
  const source = inlineSource ?? (await fs.readFile(file, "utf8"))
  if (inlineSource !== undefined) {
    const configDir = path.join(Global.Path.config, "workflows")
    await fs.mkdir(configDir, { recursive: true })
    // Resolve the dir to its REALPATH before writing+importing. On macOS the temp
    // root is `/var/folders/...` (a symlink to `/private/var/...`); Bun's dynamic
    // `import()` resolves the `file://` URL through the realpath, so after the first
    // temp module in this dir is imported-then-deleted, a SECOND import of a new
    // file under the symlinked path fails with "Cannot find module … from ''" (a
    // stale per-directory resolver entry). Writing+importing via the realpath keeps
    // both starts consistent so repeated source-string loads (two builtins, two
    // inline starts, or the same one twice) all succeed.
    const workflowsDir = await fs.realpath(configDir)
    // Strip the synthetic `<scheme>:` marker prefix (builtin:/inline:) so the temp
    // file name is just a sanitized basename, not a path with a colon in it.
    const cachePath = path.join(workflowsDir, tempFileName(`${file.replace(/^[a-z]+:/, "")}.ts`))
    await fs.writeFile(cachePath, source)
    const imported = (await import(pathToFileURL(cachePath).href).finally(() =>
      fs.rm(cachePath, { force: true }),
    )) as Record<string, unknown>
    return finishModule(imported, file, source)
  }
  const dir = path.dirname(file)
  const cachePath = path.join(dir, tempFileName(file))
  // Fund 40 (b): the temp copy must live in the source directory so relative
  // imports / node_modules resolution still work. If that directory is not
  // writable (read-only or external mount), fall back to importing the original
  // file directly instead of hard-failing. Caveat: a direct import is subject to
  // the runtime's module cache, so an edit between two starts of a workflow in a
  // read-only dir may serve a stale module — acceptable, since a read-only dir
  // is not being edited in place anyway.
  let importPath = cachePath
  let cleanup = () => fs.rm(cachePath, { force: true })
  const wrote = await fs.writeFile(cachePath, source).then(
    () => true,
    () => false,
  )
  if (!wrote) {
    importPath = file
    cleanup = () => Promise.resolve()
  }
  const imported = (await import(pathToFileURL(importPath).href).finally(cleanup)) as Record<string, unknown>
  return finishModule(imported, file, source)
}

// Unwraps the imported module (default-object vs named exports), validates its
// meta against the same `Meta` schema, and asserts a `run` function — shared by
// the file and built-in load paths so both fail identically (InvalidError naming
// the source) when meta is bad or `run` is missing.
function finishModule(imported: Record<string, unknown>, file: string, source: string): Module {
  const module = (
    typeof imported.default === "object" && imported.default !== null ? imported.default : imported
  ) as Record<string, unknown>
  const parsed = decodeMeta(module.meta, { errors: "all", propertyOrder: "original" })
  if (Exit.isFailure(parsed)) throw new InvalidError({ path: file, message: Cause.pretty(parsed.cause) })
  if (typeof module.run !== "function") throw new InvalidError({ path: file, message: "Missing run(args, ctx) export" })
  return {
    meta: parsed.value,
    run: module.run as Module["run"],
    source,
  }
}

function assistantText(message: SessionV1.WithParts) {
  return message.parts
    .filter((part): part is SessionV1.TextPart => part.type === "text" && part.text.trim().length > 0)
    .map((part) => part.text)
    .join("\n")
}

// Fund 40: opportunistically remove orphaned loadModule temp copies (left
// behind by a process killed mid-import) from a workflows directory, but only
// when they are older than TEMP_FILE_MAX_AGE_MS so a temp copy of a CURRENTLY
// loading workflow is never deleted out from under it. Best-effort: any error
// (missing dir, race, permission) is swallowed — a stale temp file is harmless
// since it is never discovered as a workflow (wrong extension + filter below).
async function sweepTempFiles(workflowsDir: string) {
  const names = await fs.readdir(workflowsDir).catch(() => [] as string[])
  const cutoff = Date.now() - TEMP_FILE_MAX_AGE_MS
  await Promise.all(
    names
      .filter((name) => TEMP_FILE_RE.test(name))
      .map(async (name) => {
        const full = path.join(workflowsDir, name)
        const stat = await fs.stat(full).catch(() => undefined)
        if (stat && stat.mtimeMs < cutoff) await fs.rm(full, { force: true }).catch(() => undefined)
      }),
  )
}

// Finding 3: best-effort startup sweep of orphaned per-step worktree base dirs
// (`<tmp>/oc-wf-*`) left behind by a SIGKILLed/crashed run whose run-scope remove
// finalizer never fired. Only dirs older than WORKTREE_MAX_AGE_MS are touched so a
// worktree of a CURRENTLY running sibling process is never removed out from under
// it. Each stale dir is detached as a git worktree first (so the source repo's
// worktree list does not keep a dangling registration) and then removed, and a
// final `git worktree prune` reclaims any other stale registrations. Best-effort:
// every error (missing dir, race, permission, non-git, locked tree) is swallowed.
async function sweepWorktrees(directory: string) {
  const tmp = os.tmpdir()
  const names = await fs.readdir(tmp).catch(() => [] as string[])
  const cutoff = Date.now() - WORKTREE_MAX_AGE_MS
  await Promise.all(
    names
      .filter((name) => name.startsWith(WORKTREE_PREFIX))
      .map(async (name) => {
        const full = path.join(tmp, name)
        const stat = await fs.stat(full).catch(() => undefined)
        if (!stat || !stat.isDirectory() || stat.mtimeMs >= cutoff) return
        // Item 7: a worktree the run finalizer deliberately preserved carries the
        // marker — never sweep it, no matter how old.
        const preserved = await fs
          .stat(path.join(full, WORKTREE_PRESERVED_MARKER))
          .then(() => true)
          .catch(() => false)
        if (preserved) return
        // Fallback for a preserve whose marker write failed (or a crashed run
        // with real work in flight): the same dirty check the finalizer uses. A
        // non-git/leaked dir fails git-status and is swept as before.
        const status = spawnSync("git", ["status", "--porcelain"], { cwd: full })
        if (status.status === 0 && status.stdout.toString().trim().length > 0) return
        // Detach the registration from the owning repo (best-effort), then remove
        // the leaked dir. `remove --force` covers the common case; the explicit rm
        // is the backstop for a dir git no longer recognizes as a worktree.
        spawnSync("git", ["worktree", "remove", "--force", full], { cwd: directory })
        await fs.rm(full, { recursive: true, force: true }).catch(() => undefined)
      }),
  )
  // Reclaim any dangling worktree registrations whose dir is already gone.
  spawnSync("git", ["worktree", "prune"], { cwd: directory })
}

// Fund 2: a discovered file must really live inside its workflows directory.
// We glob WITHOUT following symlinks, but a symlinked file entry can still be
// returned, so we additionally resolve the realpath of both the file and the
// workflows directory and require the file to stay within it. A symlink that
// escapes the directory (e.g. -> /tmp/payload.ts) is dropped, so it can never
// be listed/started — a reviewer eyeballing the directory only sees the harmless
// link, never the external target. Returns true when the file is safe to keep.
async function withinWorkflowsDir(file: string, workflowsDir: string): Promise<boolean> {
  const [realFile, realDir] = await Promise.all([
    fs.realpath(file).catch(() => undefined),
    fs.realpath(workflowsDir).catch(() => undefined),
  ])
  if (!realFile || !realDir) return false
  const prefix = realDir.endsWith(path.sep) ? realDir : realDir + path.sep
  return realFile.startsWith(prefix)
}

// `directories` is ordered by precedence (project before global, see
// discoverWorkflows): the first directory that contributes a given workflow
// NAME wins, so a project workflow shadows a same-named global one. Within a
// directory the glob excludes temp copies by extension; TEMP_FILE_RE filters
// any remaining match defensively, and the symlink boundary check drops escapes.
type Discovered = { name: string; path: string; source?: string }

async function discover(directories: readonly string[]) {
  const seen = new Set<string>()
  const result: Discovered[] = []
  for (const dir of directories) {
    const workflowsDir = path.join(dir, "workflows")
    // Fire-and-forget sweep of stale temp copies in this directory.
    await sweepTempFiles(workflowsDir)
    const files = (
      await Promise.all(
        ["workflows/*.ts", "workflows/*.js"].map((pattern) =>
          Glob.scan(pattern, { cwd: dir, absolute: true, dot: true, symlink: false }),
        ),
      )
    )
      .flat()
      .filter((file) => !TEMP_FILE_RE.test(path.basename(file)))
    const kept = await Promise.all(
      files.map(async (file) => ((await withinWorkflowsDir(file, workflowsDir)) ? file : undefined)),
    )
    for (const file of kept) {
      if (!file) continue
      const name = path.basename(file, path.extname(file))
      if (seen.has(name)) continue
      seen.add(name)
      result.push({ name, path: file })
    }
  }
  // Built-in workflows are the LOWEST-precedence root: appended after every
  // project/global directory so a same-named file already in `seen` shadows the
  // builtin (first-wins). A builtin carries its module SOURCE inline and a
  // synthetic `builtin:<name>` path marker — list() reads meta from that source
  // string and start() loads the module from it, neither touching the filesystem.
  for (const [name, source] of Object.entries(BUILTIN_WORKFLOWS)) {
    if (seen.has(name)) continue
    seen.add(name)
    result.push({ name, path: builtinPath(name), source })
  }
  return result.toSorted((a, b) => a.name.localeCompare(b.name))
}

function projectConfigDir(ctx: { directory: string; worktree: string }) {
  return path.join(ctx.worktree === "/" ? ctx.directory : ctx.worktree, ".opencode")
}

// The legal workflow-file basename charset, identical to the workflow tool's
// WORKFLOW_NAME_PATTERN (tool/workflow.ts) and the discover()-time name shape: a
// discovered name is just a file basename, so save() must accept exactly the same
// shape it writes. Rejecting anything else keeps a save() name from escaping the
// workflows dir (a `/`/`..` segment) or carrying glob metacharacters.
const SAVE_NAME_PATTERN = /^[A-Za-z0-9_-]+$/

// Resolves the absolute destination file for save(): `project` → the workspace
// `.opencode/workflows/<name>.ts` (the dir discover() globs FIRST, so a saved
// project workflow is immediately discoverable and shadows a same-named global
// one); `global` → `<config>/workflows/<name>.ts` (where discover() globs global
// workflows from, via config.directories()). The name is already sanitized by the
// caller against SAVE_NAME_PATTERN.
function saveTargetPath(ctx: { directory: string; worktree: string }, scope: SaveScope, name: string) {
  const base = scope === "global" ? path.join(Global.Path.config) : projectConfigDir(ctx)
  return path.join(base, "workflows", `${name}.ts`)
}

function createContext(input: {
  active: Active
  agent: (input: AgentInput, callOpts?: { phaseModel?: string }) => Promise<{ data: unknown; text: string } | null>
  shell: ContextApi["shell"]
  question: ContextApi["question"]
  workflow: ContextApi["workflow"]
  permissionSessionID?: SessionID
  persist: () => void
  /** AbortSignal of the run fiber; fires when the run is interrupted/cancelled. */
  signal: () => AbortSignal | undefined
  /**
   * Run-relative prefix for `ctx.log`/`ctx.setPhase` messages. Empty for the
   * top-level run; set to `"<child-name>: "` for a depth-1 nested workflow so its
   * logs/phases are attributable to the child without a second run row.
   */
  logPrefix?: string
  /**
   * The NORMALIZED declared phases of THIS context's module (Task 15) — the
   * top-level run's `module.meta.phases` or, for a nested ctx.workflow child, the
   * CHILD module's phases. `setPhase` resolves a phase's default model and detects
   * an undeclared phase against THIS list, so a nested child looks up its OWN
   * phases (not the parent's), and the prefixed `current_phase` string never needs
   * decoding. Omitted ⇒ no declared phases (every setPhase is "undeclared").
   */
  phases?: readonly Phase[]
  /**
   * Runs the parallel/pipeline task graph as a child of the run scope (not as a
   * detached root fiber): closing the run scope on cancel/remove propagates
   * Interrupt into the in-flight graph. An interrupted graph rejects as
   * CancelledError so the workflow body unwinds as `cancelled`.
   */
  dispatch: <A>(effect: Effect.Effect<A, unknown>) => Promise<A>
}): ContextApi {
  const checkpoint = () => {
    // Also treat a landed cancel/pause as an abort even before the run fiber's
    // signal has been observed, so a follow-up step is gated the moment cancel or
    // pause started.
    if (input.signal()?.aborted || input.active.cancelling || input.active.pausing) throw new CancelledError()
  }
  return {
    // Live remaining budget (USD), read on every access so a workflow can
    // observe the value shrink across agent steps. `Infinity` when the run was
    // started without a budget (unchanged default).
    get budgetRemaining() {
      return input.active.budgetRemaining
    },
    // Claude-Code API-shape view over the same spend the run tracks. `total` is
    // the cap (null when unlimited), `spent()` the running total charged so far,
    // `remaining()` the headroom (Infinity when unlimited). All read live so a
    // workflow sees them change across agent steps, mirroring `budgetRemaining`.
    budget: {
      get total() {
        // Item 24: with a shared turn pool and NO run budget, the pool's cap
        // is the reported total (Claude-Code semantics — the turn's budget).
        // A run budget keeps the run-scoped view.
        if (input.active.budgetTotal === undefined && input.active.pool?.usd) return input.active.pool.usd.total
        return input.active.budgetTotal ?? null
      },
      spent: () => {
        // Item 24: pool view = the TURN's total committed spend, INCLUDING the
        // main loop's chargeDirect share — only when no run budget keeps the
        // run-scoped view.
        if (input.active.budgetTotal === undefined && input.active.pool?.usd) return input.active.pool.usd.committed
        return input.active.costSpent
      },
      remaining: () => {
        // Item 24: the tighter of run headroom and pool headroom wins; either
        // absent contributes Infinity, so the prior single-budget behavior is
        // preserved exactly.
        const pool = input.active.pool?.usd
        const poolRemaining = pool ? Math.max(0, pool.total - pool.committed - pool.reserved) : Infinity
        const runRemaining =
          input.active.budgetTotal === undefined
            ? Infinity
            : Math.max(0, input.active.budgetTotal - input.active.costSpent)
        return Math.min(runRemaining, poolRemaining)
      },
      // Item 17: the token trio, mirroring the USD trio above 1:1 (live reads,
      // null/Infinity for an unset cap).
      get tokensTotal() {
        return input.active.tokensBudgetTotal ?? null
      },
      tokensSpent: () => input.active.tokensSpent,
      tokensRemaining: () =>
        input.active.tokensBudgetTotal === undefined
          ? Infinity
          : Math.max(0, input.active.tokensBudgetTotal - input.active.tokensSpent),
    },
    setPhase(phase: string) {
      input.active.run.current_phase = (input.logPrefix ?? "") + phase
      // Task 15: resolve this phase against THIS context's declared phases (the
      // raw `phase` name, never the prefixed string), keyed by `title`. A declared
      // phase's `model` becomes the active per-phase default model that ctx.agent
      // uses when a call gives no explicit model; an undeclared phase clears the
      // default AND logs a warning (never an error — an undeclared phase is allowed,
      // it simply has no default model). The lookup uses the SAME context's phases
      // so a nested child resolves against its own declarations and the parent's
      // restored on return (runNested snapshots/restores currentPhaseModel too).
      const declared = input.phases?.find((entry) => entry.title === phase)
      if (declared) {
        input.active.currentPhaseModel = declared.model
      } else {
        input.active.currentPhaseModel = undefined
        input.active.run.logs.push({
          time: Date.now(),
          phase: input.active.run.current_phase,
          message: `${input.logPrefix ?? ""}phase "${phase}" is not declared`,
        })
      }
      input.persist()
    },
    log(message: string) {
      input.active.run.logs.push({
        time: Date.now(),
        phase: input.active.run.current_phase,
        message: (input.logPrefix ?? "") + message,
      })
      input.persist()
    },
    parallel<T>(tasks: readonly (() => Promise<T>)[], options?: { concurrencyLimit?: number }) {
      checkpoint()
      // Batch cap AFTER checkpoint() (abort wins, matching ctx.agent's gate
      // order): an oversized batch is an authoring error reported at the call
      // site. The synchronous throw propagates like any body error — run failed
      // unless the author catches it.
      if (tasks.length > MAX_BATCH_ITEMS)
        throw new InvalidError({
          path: input.active.run.workflow,
          message: `ctx.parallel supports at most ${MAX_BATCH_ITEMS} tasks, got ${tasks.length}`,
        })
      const concurrency = Math.max(1, options?.concurrencyLimit ?? 20)
      // Each task is gated by the run's abort signal via checkpoint() before it
      // starts: once cancel has fired, not-yet-started tasks throw CancelledError
      // and never run. The whole batch runs as a child of the run scope (via
      // dispatch), so a cancel/remove that closes the run scope ALSO interrupts
      // tasks already in flight — and each agent task additionally aborts its
      // child session for real via PromptOps.cancel.
      return input.dispatch(
        Effect.forEach(
          tasks,
          (task, index) =>
            Effect.promise(() => {
              checkpoint()
              // P1 (Claude parity): a rejecting task resolves to `null` at its
              // position instead of failing the whole batch. CancelledError stays
              // fatal (an abort is not a task failure). The drop is logged — never
              // silent.
              return task().then(
                (value) => value as T | null,
                (error) => {
                  if (error instanceof CancelledError) throw error
                  input.active.run.logs.push({
                    time: Date.now(),
                    phase: input.active.run.current_phase,
                    message: `parallel task ${index + 1} dropped: ${error instanceof Error ? error.message : String(error)}`,
                  })
                  input.persist()
                  return null
                },
              )
            }),
          { concurrency },
        ),
      )
    },
    // Real per-item pipeline (heterogeneous stages). The public type is the
    // precise overloaded `PipelineFn`; internally we plumb `unknown` because the
    // variadic stage chain cannot be expressed in a single impl signature. The
    // last argument is an optional `{ concurrencyLimit }` object (a plain object,
    // never a function) — everything before it is a stage.
    pipeline: ((items: readonly unknown[], ...rest: unknown[]) => {
      checkpoint()
      const last = rest[rest.length - 1]
      const hasOptions = typeof last === "object" && last !== null
      const options = (hasOptions ? last : undefined) as PipelineOptions | undefined
      const stages = (hasOptions ? rest.slice(0, -1) : rest) as ReadonlyArray<
        (prev: unknown, item: unknown, index: number) => Promise<unknown>
      >
      // Same batch cap as parallel() (after checkpoint() and options parsing):
      // an oversized item list is an authoring error reported at the call site.
      if (items.length > MAX_BATCH_ITEMS)
        throw new InvalidError({
          path: input.active.run.workflow,
          message: `ctx.pipeline supports at most ${MAX_BATCH_ITEMS} items, got ${items.length}`,
        })
      // Same clamp as parallel(): an explicit limit ≤0 is floored to 1, matching
      // parallel's `Math.max(1, …)`. Only an UNSET limit means "unbounded".
      const concurrency = options?.concurrencyLimit === undefined ? "unbounded" : Math.max(1, options.concurrencyLimit)
      // No barrier between stages: each ITEM runs the full stage SEQUENCE as its
      // own Effect, and items run under Effect.forEach concurrency — so item B may
      // be in stage 2 while item A is still in stage 1. checkpoint() gates before
      // each stage so the next stage never starts after cancel. The whole graph
      // runs as a child of the run scope (via dispatch), so a cancel/remove that
      // closes the run scope interrupts stages already in flight too; agent
      // stages additionally abort their child session for real via PromptOps.cancel.
      return input.dispatch(
        Effect.forEach(
          items,
          (item, index) =>
            Effect.promise(async () => {
              let current: unknown = item
              try {
                for (const stage of stages) {
                  checkpoint()
                  // Every stage receives the item's position in the ORIGINAL items
                  // array as its third argument (Effect.forEach supplies it, same
                  // as parallel() above) so a stage can address per-item state.
                  current = await stage(current, item, index)
                }
                return current
              } catch (error) {
                // P2: a throwing stage drops ONLY this item (null) and skips its
                // remaining stages; other items keep running. Abort stays fatal.
                // The drop log uses the forEach `index` (not items.indexOf), so
                // duplicate items report their TRUE position, not the first
                // occurrence's.
                if (error instanceof CancelledError) throw error
                input.active.run.logs.push({
                  time: Date.now(),
                  phase: input.active.run.current_phase,
                  message: `pipeline item ${index + 1} dropped: ${error instanceof Error ? error.message : String(error)}`,
                })
                input.persist()
                return null
              }
            }),
          { concurrency },
        ),
      )
    }) as ContextApi["pipeline"],
    // Item 16: a per-call `phase` is resolved HERE because only createContext
    // knows this context's logPrefix and declared phases. The phase reaching the
    // engine closure is already PREFIXED (consistent with setPhase above), so a
    // nested ctx.workflow child's per-call phase is attributed to the child; the
    // declared phase's default `model` rides along as a per-call option. No
    // global state moves: current_phase/currentPhaseModel are untouched.
    agent: (ai) => {
      if (ai.phase === undefined) return input.agent(ai)
      const declared = input.phases?.find((entry) => entry.title === ai.phase)
      return input.agent({ ...ai, phase: (input.logPrefix ?? "") + ai.phase }, { phaseModel: declared?.model })
    },
    shell: input.shell,
    question: input.question,
    workflow: input.workflow,
  }
}

export function fmt(list: Info[]) {
  const described = list.filter((workflow) => workflow.meta.description !== undefined)
  if (described.length === 0) return "No workflows are currently available."
  return [
    "<available_workflows>",
    ...described
      .toSorted((a, b) => a.name.localeCompare(b.name))
      .flatMap((workflow) => [
        "  <workflow>",
        `    <name>${workflow.name}</name>`,
        `    <description>${workflow.meta.description}</description>`,
        ...(workflow.meta.whenToUse ? [`    <when_to_use>${workflow.meta.whenToUse}</when_to_use>`] : []),
        `    <path>${pathToFileURL(workflow.path).href}</path>`,
        ...(workflow.meta.phases?.length
          ? [`    <phases>${workflow.meta.phases.map((phase) => phase.title).join(", ")}</phases>`]
          : []),
        ...(workflow.meta.arguments
          ? [
              "    <arguments>",
              ...Object.entries(workflow.meta.arguments).map(
                ([name, arg]) =>
                  `      <argument name="${name}" type="${arg.type ?? "string"}">${arg.description ?? ""}</argument>`,
              ),
              "    </arguments>",
            ]
          : []),
        "  </workflow>",
      ]),
    "</available_workflows>",
  ].join("\n")
}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const config = yield* Config.Service
    const agents = yield* Agent.Service
    const sessions = yield* Session.Service
    const { db } = yield* Database.Service
    const events = yield* EventV2Bridge.Service
    // Item 23 (Stufe 1): the permission service gates ctx.shell; FSUtil and the
    // spawner feed the bash tool's scanCommand (path/pattern derivation), which
    // is provided these explicitly at the call site inside ctx.shell.
    const permission = yield* Permission.Service
    const fsUtil = yield* FSUtil.Service
    const spawner = yield* ChildProcessSpawner
    const state = yield* InstanceState.make<State>(
      Effect.fn("Workflow.state")(function* (ctx) {
        const runs = yield* SynchronizedRef.make(new Map<string, Active>())
        // The registry is freshly empty here: any row still marked `running`
        // belongs to a fiber that did not survive into this process, so sweep
        // every one of them to `interrupted` (honest orphan recovery on start).
        // Scoped to THIS workspace directory (Fund 17): this state is created
        // per-directory, so the startup sweep must heal only its OWN zombie rows
        // — a sibling directory's live run shares the global DB and must be left
        // running.
        yield* sweepOrphans(db, new Set(), yield* Clock.currentTimeMillis, ctx.directory)
        // Finding 3: reclaim stale per-step worktree base dirs (`<tmp>/oc-wf-*`)
        // leaked by a crashed run whose remove finalizer never fired, so a
        // SIGKILLed run does not leave repo content + secrets in tmp. Bounded
        // (a single tmp readdir + rm of only aged dirs) and best-effort: any error
        // is swallowed, and it runs inline alongside the DB orphan sweep so it
        // cannot be interrupted by an instance teardown mid-sweep.
        yield* Effect.promise(() => sweepWorktrees(ctx.directory)).pipe(Effect.ignore)
        return {
          runs,
          scope: yield* Scope.Scope,
        }
      }),
    )

    // Wire the instance-aware test seam now that `state` exists (Finding 10).
    setPausingHook = (id: string) =>
      Effect.gen(function* () {
        const active = (yield* SynchronizedRef.get((yield* InstanceState.get(state)).runs)).get(id)
        if (!active) return false
        active.pausing = true
        return true
      })

    const readRuns = Effect.fn("Workflow.readRuns")(function* () {
      const active = yield* SynchronizedRef.get((yield* InstanceState.get(state)).runs)
      // Scope the listing to the calling workspace (Fund 6): the DB is global,
      // so without the directory filter `GET /workflow/run?directory=A` would
      // leak runs started in directory B.
      const directory = yield* InstanceState.directory
      const rows = yield* db
        .select()
        .from(WorkflowRunTable)
        .where(eq(WorkflowRunTable.directory, directory))
        .orderBy(desc(WorkflowRunTable.started_at))
        .all()
        .pipe(Effect.orDie)
      return rows
        .map(fromRow)
        .map((run) => {
          const live = active.get(run.id)
          return live ? snapshot(live) : run
        })
        .toSorted((a, b) => b.started_at - a.started_at)
    })

    // Shared discovery for list() and start(): resolves the config + project
    // directories and globs them into a sorted `{ name, path }[]`. No module is
    // loaded here — loading is the caller's concern (list loads all per-file,
    // start loads only the target).
    //
    // N4 (precedence, behavior change): the project config dir is placed FIRST,
    // ahead of config.directories() (which leads with the GLOBAL ~/.config
    // dir). discover() dedups by NAME with first-wins, so a project workflow now
    // shadows a same-named global one — previously the global file won, which
    // meant create "validated" / start ran the wrong file when both existed.
    const discoverWorkflows = Effect.fn("Workflow.discover")(function* () {
      const ctx = yield* InstanceState.context
      const directories = [...new Set([projectConfigDir(ctx), ...(yield* config.directories())])]
      return yield* Effect.promise(() => discover(directories))
    })

    const list: Interface["list"] = Effect.fn("Workflow.list")(function* () {
      const workflows = yield* discoverWorkflows()
      // Discovery NEVER executes workflow module code: meta is extracted purely
      // from each file's source text via the static AST reader. `loadModule` (a
      // real dynamic import that runs the module's top-level code) is reserved for
      // start(), AFTER the permission gate. This closes the root cause where merely
      // listing/reading/autocompleting workflows in a cloned workspace ran foreign
      // code before any prompt. Per-file error isolation is kept: a file whose meta
      // is missing, dynamic (not statically analyzable), or schema-invalid becomes
      // an `{ valid: false, error }` entry instead of aborting the whole list.
      return yield* Effect.forEach(
        workflows,
        (workflow) =>
          // A builtin carries its module source inline (no file to read); an
          // on-disk workflow's source comes from its file. MetaReader.read takes
          // the source string directly either way, so a builtin is meta-extracted
          // through the identical static (never-executed) path. `source_kind` is
          // stamped only on builtins so consumers can tell them apart.
          Effect.promise(() =>
            workflow.source !== undefined ? Promise.resolve(workflow.source) : fs.readFile(workflow.path, "utf8"),
          ).pipe(
            Effect.map((source): Info => {
              const kind = workflow.source !== undefined ? ({ source_kind: "builtin" } as const) : {}
              const result = MetaReader.read(source, workflow.path)
              return result.valid
                ? { name: workflow.name, path: workflow.path, meta: result.meta, valid: true, ...kind }
                : // Synthesize a minimal meta so the schema stays satisfied and
                  // consumers can still show the file's name; `valid: false`
                  // signals the entry is not runnable.
                  {
                    name: workflow.name,
                    path: workflow.path,
                    meta: { name: workflow.name },
                    valid: false,
                    error: result.error,
                    ...kind,
                  }
            }),
          ),
        { concurrency: "unbounded" },
      )
    })

    const read: Interface["read"] = Effect.fn("Workflow.read")(function* (name) {
      // Resolve the single named target through the SAME discovery precedence
      // start() uses (project > global > builtin), so the preview shows exactly the
      // source that would run. A builtin carries its module string inline
      // (workflow.source); an on-disk workflow's source is its file text. Neither
      // executes the module — this is a pure source read, like list()'s meta pass.
      const discovered = yield* discoverWorkflows()
      const found = discovered.find((item) => item.name === name)
      if (!found) return undefined
      const source =
        found.source !== undefined ? found.source : yield* Effect.promise(() => fs.readFile(found.path, "utf8"))
      return {
        name: found.name,
        path: found.path,
        source,
        ...(found.source !== undefined ? ({ source_kind: "builtin" } as const) : {}),
      }
    })

    const runs: Interface["runs"] = Effect.fn("Workflow.runs")(function* () {
      return yield* readRuns()
    })

    const get: Interface["get"] = Effect.fn("Workflow.get")(function* (id) {
      const active = (yield* SynchronizedRef.get((yield* InstanceState.get(state)).runs)).get(id)
      if (active) return snapshot(active)
      // Cold DB read is scoped to the calling workspace (Fund 6): `get(id)` from
      // directory B must not see a run that belongs to directory A even though
      // both share the global DB. The in-memory branch above is already scoped
      // because the registry is per-directory.
      const directory = yield* InstanceState.directory
      const row = yield* db
        .select()
        .from(WorkflowRunTable)
        .where(and(eq(WorkflowRunTable.id, id), eq(WorkflowRunTable.directory, directory)))
        .get()
        .pipe(Effect.orDie)
      if (!row) return
      return fromRow(row)
    })

    const finish = Effect.fn("Workflow.finish")(function* (
      id: RunID,
      status: Exclude<Status, "running">,
      data?: { result?: unknown; error?: string },
    ) {
      const completed_at = yield* Clock.currentTimeMillis
      const active = (yield* SynchronizedRef.get((yield* InstanceState.get(state)).runs)).get(id)
      if (!active) return
      if (active.run.status !== "running") return snapshot(active)
      active.run.status = status
      active.run.completed_at = completed_at
      // N2/N13: a workflow's return value reaches `finish` 1:1 from `module.run`
      // (`Promise<unknown>`) and is otherwise unvalidated. Normalize it ONCE here —
      // the single point an untrusted result enters the engine — through the SAME
      // JSON codec the persist uses (`JSON.stringify` then re-parse), so the value
      // stored on `active.run.result` matches exactly what the DB round-trips:
      // functions/symbols/class instances are dropped silently (as the persist's
      // `JSON.stringify` already does), not left to crash `snapshot`/the persist.
      // `JSON.stringify` itself can still throw on circular references or BigInt,
      // so the normalization is guarded with `Effect.try` captured as an
      // `Effect.exit` (no try/catch per the engine style; same fail-soft posture as
      // the terminal persist's `Effect.exit` guard below — waiters always observe a
      // terminal state). On failure the run still finishes honestly with a result of
      // `{ $unserializable: "<message>" }` rather than hanging the run or losing the
      // terminal transition.
      const normalized = yield* Effect.try({
        try: () => (data?.result === undefined ? undefined : (JSON.parse(JSON.stringify(data.result)) as unknown)),
        catch: (error) => (error instanceof Error ? error.message : String(error)),
      }).pipe(Effect.exit)
      active.run.result =
        normalized._tag === "Success" ? normalized.value : { $unserializable: String(Cause.squash(normalized.cause)) }
      active.run.error = data?.error
      active.fiber = undefined
      // Close out EVERY agent node still marked `running` at the terminal
      // transition — for ALL terminal statuses, completed included (N11). A run
      // can reach `completed` while an agent node is still running without any
      // author error: a fire-and-forget `ctx.agent` whose promise settles after
      // the body returns, or a settlement race. Gating this on the non-completed
      // statuses left such a node persisted as `running` forever (TUI live icon),
      // and its detached child session kept burning tokens. Now the node always
      // gets a terminal status + completed_at + an explanatory error, and the
      // still-open child sessions are aborted below.
      const lingering = active.run.agents.filter((node) => node.status === "running")
      for (const node of lingering) {
        node.status = "failed"
        node.completed_at = completed_at
        node.error ??=
          status === "cancelled"
            ? "Cancelled"
            : status === "paused"
              ? "Paused"
              : status === "completed"
                ? "agent step never settled before the run completed"
                : "Workflow failed"
      }
      // Abort the child session of every node that was still running, so a
      // detached agent does not keep spending after the run is terminal (N11).
      // The per-run scope close below interrupts the dispatched agent FIBER, but
      // that does not run the prompt-ops `cancel` vector (the actual session
      // abort, same path as TUI Esc / HTTP abort) — so abort explicitly here.
      // Idempotent: on the cancel/remove path abortRun already aborted these, and
      // a node with no session_id (never reached session creation) is skipped.
      if (active.cancelSession) {
        const cancelSession = active.cancelSession
        yield* Effect.forEach(
          lingering.flatMap((node) => (node.session_id ? [node.session_id] : [])),
          (sessionID) => cancelSession(SessionID.make(sessionID)),
          { concurrency: "unbounded", discard: true },
        ).pipe(Effect.ignore)
      }
      // N2: a failing terminal persist must NEVER strand the `done` deferred —
      // `persistRun` is `orDie`, so a DB error on the terminal write used to kill
      // the finish fiber and the deferred was never resolved, hanging every
      // no-timeout `wait()` (and background jobs) forever. `Effect.exit` captures
      // ANY outcome of the persist (success, failure, or the `orDie` defect) as a
      // value, so execution ALWAYS continues to the resolve below — the persist
      // can fail and waiters still observe the terminal state (a cut-short write
      // is healed by the startup orphan sweep on next restart).
      //
      // Fund 42: the persist runs BEFORE the resolve so a successful terminal
      // write is already committed by the time a waiter wakes — a direct DB read
      // right after `wait()` sees the final row (incl. a `null` result serialized
      // as the text `"null"`) instead of racing an in-flight progress write. The
      // `Effect.exit` guard keeps this ordering safe for the failing-persist case.
      const result = snapshot(active)
      // Finding 2 test seam: surface the in-memory spend accumulators at the
      // terminal transition (never persisted, so otherwise unobservable post-run).
      if (captureSpendHook)
        captureSpendHook(id, { budgetRemaining: active.budgetRemaining, costSpent: active.costSpent })
      yield* persistRun(db, events, active, { terminal: true }).pipe(Effect.exit)
      yield* Deferred.succeed(active.done, result).pipe(Effect.ignore)
      // N1: evict the terminal run from the in-memory registry so the map does not
      // grow unbounded for a long-lived instance, and so a dead run's heavy
      // in-memory snapshot (full logs/agents/result) is no longer pinned ahead of
      // its DB row by get()/readRuns() (a divergence once the row is later edited
      // out-of-band, e.g. by a sweep). ORDER is critical (3e/N2): the eviction runs
      // only AFTER (a) the terminal persist above committed the DB row — so get()
      // after evict reads a real row through fromRow, never a hole — and AFTER (b)
      // `Deferred.succeed`, so a waiter already holds the terminal snapshot from the
      // resolved deferred even if it wakes exactly at the eviction; a subsequent
      // get() then falls back to that committed DB row. Safe even when the terminal
      // persist FAILED (the `Effect.exit` above): the startup orphan sweep heals a
      // cut-short row, and an evicted-but-unpersisted run is simply no longer
      // readable until then — strictly better than a forever-pinned stale snapshot.
      const inst = yield* InstanceState.get(state)
      yield* SynchronizedRef.update(inst.runs, (runs) => {
        if (!runs.has(id)) return runs
        const next = new Map(runs)
        next.delete(id)
        return next
      })
      // Free the per-run scope now that the run is terminal so it does not linger
      // (one empty child scope per run) on the instance scope until teardown. By
      // the time finish runs the body fiber has exited and all dispatched agent
      // fibers have settled, so this interrupts nothing live; on the cancel/remove
      // path abortRun already closed it and a second close is a no-op. Forked so a
      // finalizer cannot delay the terminal return.
      yield* Scope.close(active.runScope, Exit.void).pipe(Effect.ignore, Effect.forkIn(inst.scope))
      return result
    })

    const start: Interface["start"] = Effect.fn("Workflow.start")(function* (input) {
      // Item 17: normalize the budget ONCE — a naked number is USD (back-compat
      // for every existing caller), the struct form carries independent usd/token
      // caps; unset ⇒ both unlimited.
      const budget = typeof input.budget === "number" ? { usd: input.budget } : (input.budget ?? {})
      // Resolve the start TARGET — `{ name, path, source? }` — either by discovery
      // (a named workflow: project/global file or bundled builtin) or, when an
      // inline `source` is supplied WITHOUT a name (P3), as a synthetic inline
      // target that is never discovered and never written to the project. Both
      // feed the SAME source-string/file load path below, so the run lifecycle,
      // permission boundary, and argument coercion are source-agnostic.
      let target: { name: string; path: string; source?: string }
      if (input.source !== undefined && input.name === undefined) {
        // Inline-source start: read the meta STATICALLY from the source (AST-only,
        // never executes the module). The tool already pre-validates before its
        // permission ask; the engine validates again defensively so a programmatic
        // caller still fails cleanly (InvalidError) instead of defecting deep in
        // the module load. The run's name is the source's meta name.
        const read = MetaReader.read(input.source, inlinePath("inline"))
        if (read.valid === false) return yield* new InvalidError({ path: inlinePath("inline"), message: read.error })
        target = { name: read.meta.name, path: inlinePath(read.meta.name), source: input.source }
      } else {
        // Resolve the single target by name without loading every workflow: a
        // broken sibling file must not block starting a valid one. Only the target
        // module is imported, and a broken target fails precisely (InvalidError
        // naming the file) rather than as part of a whole-list failure.
        const discovered = yield* discoverWorkflows()
        const found = discovered.find((item) => item.name === input.name)
        if (!found) return yield* new NotFoundError({ name: input.name ?? "" })
        target = { name: found.name, path: found.path, source: found.source }
        // Static meta gate, IDENTICAL to the inline path above: validate the
        // source AST-only (never executing the module) BEFORE loadModule imports
        // it. The tool pre-checks via list(), but that is only ONE surface — a
        // name start via HTTP/programmatic callers/answer()-resume reached
        // loadModule ungated, letting computed meta (e.g. `name: process.env.X`)
        // slip past the pure-literal requirement. Builtins pass trivially (their
        // meta is literal by invariant). A file deleted between discovery and
        // here fails as a clean InvalidError (ENOENT text) instead of a
        // loadModule defect. The gate's file read is deliberately SEPARATE from
        // loadModule's (the TOCTOU between the two reads is accepted: the gate
        // is defense-in-depth for the permission-dialog guarantee, not a
        // security boundary against racing writers) — passing the read text as
        // inlineSource would move the module load to the global config dir and
        // break relative imports.
        const sourceText =
          target.source !== undefined
            ? target.source
            : yield* Effect.tryPromise({
                try: () => fs.readFile(target.path, "utf8"),
                catch: (error) => new InvalidError({ path: target.path, message: errorText(error) }),
              })
        const gate = MetaReader.read(sourceText, target.path)
        if (gate.valid === false) return yield* new InvalidError({ path: target.path, message: gate.error })
      }
      // tryPromise so a load failure (bad meta / missing run / syntax error)
      // surfaces as a typed InvalidError naming the file, not as an unhandled
      // defect (Effect.promise would treat a rejection as a die).
      const module = yield* Effect.tryPromise({
        // A builtin/inline target carries its module source inline (`target.source`);
        // an on-disk workflow loads from its file. Both go through loadModule's
        // temp-file import so every source runs the IDENTICAL load + validation path.
        try: () => loadModule(target.path, target.source),
        catch: (error) =>
          isInvalidError(error) ? error : new InvalidError({ path: target.path, message: errorText(error) }),
      })
      // Enforce the declared argument contract HERE — the single engine boundary
      // before the body runs — so coercion + defaults apply identically on every
      // start path (HTTP/Tool/TUI). A non-coercible value fails the start as an
      // InvalidError; nothing reaches `module.run` until the args are authoritative.
      const coerced = coerceArgs(input.args, module.meta.arguments, target.path)
      if (coerced instanceof InvalidError) return yield* coerced
      const args = coerced
      const inst = yield* InstanceState.get(state)
      // The workspace this run belongs to. Persisted to the `directory` column so
      // every later read/delete/sweep can be scoped to it (Fund 6/17).
      const directory = yield* InstanceState.directory
      // Resume journal: when `resume_of` is supplied, load the SOURCE run's
      // completed agents (directory-scoped, exactly like get()) and group them by
      // call key in occurrence order. A `ctx.agent` call in the new run consumes
      // the next unused entry for its key — replaying it verbatim instead of
      // re-prompting. Indices listed in `invalidate_agents` are excluded so they
      // re-run live. An unknown/foreign source id yields an empty journal (every
      // call then runs live), so a stale resume id degrades to a normal run rather
      // than failing the start.
      const journal = new Map<string, AgentRun[]>()
      // Item 20: the replay strategy. Default `prefix` (the safe mode): replay
      // stops permanently at the first mismatch instead of shape-matching later
      // calls whose workspace side effects may be stale. `keyed` keeps the
      // previous occurrence-cursor behavior 1:1 for read-only workflows.
      const replayMode: "prefix" | "keyed" = input.replay ?? "prefix"
      // Prefix-mode journal: the source agents in ORIGINAL order (questions
      // filtered out), INCLUDING non-completed nodes so they BREAK the prefix
      // rather than being invisibly absent.
      const journalSeq: { node: AgentRun; index: number }[] = []
      // Question replay journal (Tasks 12/13): when this resume seeds answers
      // (answer() on a paused run), map the source run's `kind:"question"` nodes to
      // their provided answer keyed by [question, phase] — the SAME shape the live
      // `ctx.question` will rebuild. On reaching that question the body is served
      // the answer from here instead of asking again.
      const questionJournal = new Map<string, string>()
      if (input.resume_of) {
        const sourceRow = yield* db
          .select()
          .from(WorkflowRunTable)
          .where(and(eq(WorkflowRunTable.id, input.resume_of), eq(WorkflowRunTable.directory, directory)))
          .get()
          .pipe(Effect.orDie)
        if (sourceRow) {
          // Status guard: paused, interrupted, FAILED, and COMPLETED runs are
          // legitimate resume sources. failed-resume carries the original core
          // iteration loop — the run fails, the author edits the script and
          // replays the completed prefix from the journal (the failed node never
          // entered the journal, so it runs live); completed-resume is the
          // 100%-cache-hit re-run of an identical script. Still forbidden:
          // `running` (the original precondition — stop the source run first) and
          // `cancelled` (the cancel-of-a-paused-run race protection: a cancelled
          // source could otherwise be re-resumed via a direct DB UPDATE to
          // `cancelled`). HTTP maps WorkflowInvalidError to 400. An unknown id
          // leaves `sourceRow` undefined and still degrades to a normal run
          // (every call runs live), unchanged.
          if (!RESUMABLE.has(sourceRow.status)) {
            return yield* new InvalidError({
              path: target.path,
              message: `Cannot resume run ${input.resume_of}: status is ${sourceRow.status} (running runs must be stopped first; cancelled runs cannot be resumed)`,
            })
          }
          // Finding 11: identity guard. The HTTP start route lets the caller choose
          // the workflow NAME (path param) and the resume source (`resume_of` body)
          // INDEPENDENTLY. Without this check, POST /workflow/B/start with
          // {resume_of: <paused run of A>} would run B but replay A's journaled
          // agent output/cost/answers wherever a journal key collides — silently
          // serving one workflow's recorded results to a different workflow's steps,
          // and recording resume_of pointing at an unrelated workflow. Require the
          // source run's workflow to MATCH the workflow being started. The answer()
          // resume path satisfies this by construction (name/source come from the
          // same source row). HTTP maps WorkflowInvalidError to 400.
          if (sourceRow.workflow !== target.name) {
            return yield* new InvalidError({
              path: target.path,
              message: `Cannot resume run ${input.resume_of}: it belongs to workflow "${sourceRow.workflow}", not "${target.name}"`,
            })
          }
          const invalidate = new Set(input.invalidate_agents ?? [])
          sourceRow.agents.forEach((node, index) => {
            // A `kind:"question"` node is replayed from the SEEDED answer (not the
            // agent journal): match it on [question, phase] and record the supplied
            // answer. The source node may be `failed`/"Paused" (a timed-out park
            // flips the still-open node), so — unlike the agent journal — we do NOT
            // gate on `completed`; the seed answer is what makes the replay valid.
            if (node.kind === "question") {
              const seeded = input.questionAnswers?.[node.prompt]
              if (seeded !== undefined) {
                questionJournal.set(questionJournalKey({ question: node.prompt, phase: node.phase }), seeded)
              }
              return
            }
            // Item 20 (prefix mode): keep the source agents as an ORDERED
            // sequence instead of the keyed map. Non-completed nodes are
            // INCLUDED — they break the prefix at their position rather than
            // being invisibly absent; `invalidate_agents` is checked at replay
            // time against the carried index (a hit breaks the prefix too).
            if (replayMode === "prefix") {
              journalSeq.push({ node: { ...node }, index })
              return
            }
            if (node.status !== "completed") return
            if (invalidate.has(index)) return
            const key = journalKey({ prompt: node.prompt, agent: node.agent, phase: node.phase })
            const bucket = journal.get(key) ?? []
            bucket.push({ ...node })
            journal.set(key, bucket)
          })
        }
      }
      const id = RunID.ascending()
      const started_at = yield* Clock.currentTimeMillis
      // Item 23 (Stufe 1): the ctx.shell asks of this run are evaluated against
      // the CALLER session's permission rules — the same inheritance the
      // subagent asks derive from. No caller identity (HTTP/headless) ⇒ empty
      // ruleset ⇒ asks fall through to the interactive default, exactly like a
      // subagent tool ask today.
      const shellCallerSession = input.caller
        ? yield* sessions.get(input.caller.sessionID).pipe(Effect.catchCause(() => Effect.succeed(undefined)))
        : undefined
      const shellRuleset = Permission.merge(shellCallerSession?.permission ?? [], [])
      const session = yield* sessions.create({ title: `Workflow: ${module.meta.name}` })
      const done = yield* Deferred.make<Run>()
      // Per-run scope forked from the instance scope. ALL agent/parallel/pipeline
      // work and all progress writes are forked into it (not into a detached
      // root fiber), so closing it on cancel/remove propagates Interrupt to the
      // in-flight agent graph; the instance teardown closes it transitively.
      const runScope = yield* Scope.fork(inst.scope)
      // Run-wide concurrency gate over every ctx.agent dispatch. Created here (at
      // run start) so it is shared by the whole run; a per-call concurrencyLimit
      // still applies on top, the narrower limit winning. The override seam is
      // captured per run so a test's tiny limit only affects runs started after it.
      const agentSemaphore = yield* Semaphore.make(agentConcurrencyCap())
      const active: Active = {
        run: {
          id,
          session_id: session.id,
          workflow: target.name,
          args: args ?? undefined,
          definition: {
            name: target.name,
            path: target.path,
            meta: mutableMeta(module.meta),
            // The RESOLVED module source for EVERY run, not just inline starts:
            // `module.source` is the file text for an on-disk workflow and the
            // bundled/inline string for a builtin/inline start (it equals
            // input.source on the inline path, so this is a strict superset of the
            // old `source: input.source`). Carrying it makes save-as-command and the
            // run-detail source view work for named/on-disk and builtin runs too,
            // which previously got `source: undefined`.
            source: module.source,
            temporary: input.temporary,
          },
          status: "running",
          started_at,
          logs: [],
          agents: [],
          resume_of: input.resume_of,
        },
        directory,
        done,
        runScope,
        sessions: new Set<string>(),
        cancelSession: input.prompt?.cancel,
        // Unset budget ⇒ Infinity ⇒ the gate never trips and the decrement is a
        // no-op, preserving the previous unlimited behavior exactly.
        budget: budget.usd ?? Number.POSITIVE_INFINITY,
        budgetRemaining: budget.usd ?? Number.POSITIVE_INFINITY,
        // Kept as the raw validated budget (undefined ⇒ no budget) so
        // `ctx.budget.total` reports `null` rather than coercing to Infinity.
        budgetTotal: budget.usd,
        costSpent: 0,
        // Item 17: independent output-token cap; undefined ⇒ unlimited.
        tokensBudgetTotal: budget.tokens,
        tokensSpent: 0,
        agentSemaphore,
        agentStarted: 0,
        agentLimit: agentLimitOverride ?? DEFAULT_AGENT_LIMIT,
        journal: input.resume_of && replayMode === "keyed" ? journal : undefined,
        journalCursor: input.resume_of && replayMode === "keyed" ? new Map<string, number>() : undefined,
        // Item 20: prefix-mode replay state. journalSeq is the ordered source
        // sequence; the cursor advances on each hit; replayBroken flips
        // permanently on the first mismatch; invalidateSet carries the
        // invalidate_agents indices for the at-replay-time check.
        journalMode: input.resume_of ? replayMode : undefined,
        journalSeq: input.resume_of && replayMode === "prefix" ? journalSeq : undefined,
        journalSeqCursor: 0,
        replayBroken: false,
        invalidateSet:
          input.resume_of && replayMode === "prefix" ? new Set(input.invalidate_agents ?? []) : undefined,
        resumeOf: input.resume_of,
        questionJournal: input.resume_of && questionJournal.size > 0 ? questionJournal : undefined,
        // Item 12: the caller session's resolved model — default-agent steps
        // without an explicit/phase model inherit it (see the chain in agent()).
        callerModel: input.caller_model,
        // Item 15: node ids a human asked to skip.
        skipRequests: new Set<string>(),
        // Item 23 (Stufe 1): the caller-inherited bash ruleset for ctx.shell.
        shellRuleset,
        // Item 24: the caller turn's shared budget pool (absent ⇒ no pool gate).
        pool: input.pool,
      }
      yield* SynchronizedRef.update(inst.runs, (runs) => new Map(runs).set(id, active))
      yield* persistRun(db, events, active)
      if (input.prompt) {
        yield* input.prompt
          .prompt({
            sessionID: session.id,
            noReply: true,
            parts: [
              {
                type: "text",
                text: [
                  `Workflow started: ${module.meta.name}`,
                  `Run ID: ${id}`,
                  "",
                  module.meta.description ?? "Use the workflow dashboard to inspect phases, agent runs, and results.",
                ].join("\n"),
              },
            ],
          })
          .pipe(Effect.ignore)
      }
      const bridge = yield* EffectBridge.make()
      // AbortSignal of the run fiber; set inside Effect.promise below and fired
      // on Fiber.interrupt. Read by ctx.agent/parallel/pipeline for gating.
      let runSignal: AbortSignal | undefined

      // Runs an effect as a CHILD of the run scope and awaits it as a promise.
      // Unlike `bridge.promise` (a detached root fiber via Effect.runPromise),
      // the work is forked into `runScope`, so closing the scope on cancel/remove
      // interrupts it. An interrupt-only outcome (the scope was closed) is
      // surfaced as a CancelledError rejection so the workflow body unwinds as
      // `cancelled`; any other failure is rejected with its representative error.
      const dispatch = <A>(effect: Effect.Effect<A, unknown>): Promise<A> =>
        bridge.promise(
          Effect.gen(function* () {
            const fiber = yield* Effect.forkIn(effect, runScope)
            const exit = yield* Fiber.await(fiber)
            if (Exit.isSuccess(exit)) return exit.value
            if (Cause.hasInterruptsOnly(exit.cause)) return yield* Effect.die(new CancelledError())
            return yield* Effect.failCause(exit.cause)
          }),
        )

      const agentStep = async (agentInput: AgentInput, callOpts?: { phaseModel?: string }) => {
        // Gate the step: a fired run signal OR a landed cancel/pause all mean the
        // run is unwinding, so refuse to start another agent step (Fund 5/4).
        if (runSignal?.aborted || active.cancelling || active.pausing || active.removed) throw new CancelledError()
        // Budget gate — ordered right AFTER the abort-signal checkpoint so a
        // cancelled run still unwinds as `cancelled` (not `failed`) before any
        // budget verdict is reached. `Infinity` (no budget set) never trips.
        // Once the prior steps have consumed the whole budget we refuse to spend
        // again: fail the step with a BudgetExceededError, which propagates like
        // any other agent failure (node `failed`, run `failed` unless caught).
        // AUDITED soft cap (T5): this gate + the post-step spend (ensuring, below)
        // run on SEPARATE turns, so N parallel ctx.parallel tasks can all pass this
        // synchronous check before any of them charges ⇒ a run may overspend by the
        // combined cost of the steps already in flight. That overspend is BOUNDED
        // (the next step after exhaustion is refused here), so it is best-effort by
        // design, not an unbounded leak — no atomic reservation is needed. Pinned by
        // "budget-race audit: 2 parallel agents with budget for 1 …".
        if (active.budgetRemaining <= 0) {
          const spent = active.budget - active.budgetRemaining
          throw new BudgetExceededError({
            message: `Workflow budget exhausted: spent ${spent} of ${active.budget} (USD) budget; refusing to start another agent step`,
            budget: active.budget,
            spent,
            unit: "usd",
          })
        }
        // Item 17: second gate for the independent output-TOKEN cap. Same
        // soft-cap semantics as the USD gate above (comment T5 applies to both:
        // parallel steps already in flight may push past the cap; the NEXT step
        // is refused). Checked after the USD gate, so with both caps exhausted
        // the USD verdict reports first.
        if (active.tokensBudgetTotal !== undefined && active.tokensSpent >= active.tokensBudgetTotal) {
          throw new BudgetExceededError({
            message: `Workflow token budget exhausted: spent ${active.tokensSpent} of ${active.tokensBudgetTotal} output tokens; refusing to start another agent step`,
            budget: active.tokensBudgetTotal,
            spent: active.tokensSpent,
            unit: "tokens",
          })
        }
        // Lifetime gate — ordered after the abort + budget gates so a cancelled
        // or over-budget run reports those first. A run may START at most
        // `agentLimit` agent dispatches; the (limit+1)-th call refuses with a
        // tagged AgentLimitError (same failure path as the budget gate: node
        // `failed`, run `failed` unless caught). Counts every dispatch attempt
        // (including journal replays) so a runaway loop cannot spin unbounded.
        if (active.agentStarted >= active.agentLimit) {
          throw new AgentLimitError({
            message: `Workflow agent lifetime limit reached: ${active.agentStarted} of ${active.agentLimit} agents started; refusing to start another agent step`,
            limit: active.agentLimit,
            started: active.agentStarted,
          })
        }
        // Moved ABOVE the pool reservation (Item 24): every throw-point between
        // the reservation and the dispatched effect's `ensuring` would leak the
        // reserved headroom, so the only remaining code on that path must be
        // non-throwing straight-line work.
        const prompt = input.prompt
        if (!prompt) throw new Error("Workflow agent execution requires prompt operations")
        // Item 24: shared turn-pool gate, AFTER every other gate (so a refusal
        // can never leak a reservation past an abort/budget/limit throw) and
        // BEFORE the node is recorded. `TurnBudget.reserve` is a SYNCHRONOUS
        // check-and-set — no await separates the headroom check from the
        // reservation, which closes the audited per-run soft-cap race (T5) for
        // the pool: of N parallel steps with priced reservations, only the ones
        // the pool can still cover pass. Per-run budget AND pool must BOTH
        // pass. The reservation is priced at the pool's rolling per-step
        // average (0 before the first settlement — the documented residual
        // soft cap for the first parallel wave). Journal replays reserve and
        // settle like live steps, mirroring the run-budget parity. The
        // matching settle lives in the step's `ensuring` below and runs on
        // EVERY outcome, so a reservation can never leak.
        const poolReservation = active.pool ? TurnBudget.reserve(active.pool, active.pool.avgStepUsd) : undefined
        if (active.pool && !poolReservation) {
          throw new BudgetExceededError({
            message: `Turn budget exhausted: spent ${active.pool.usd?.committed ?? 0} of ${active.pool.usd?.total ?? 0} (USD) shared turn pool; refusing to start another agent step`,
            budget: active.pool.usd?.total ?? 0,
            spent: active.pool.usd?.committed ?? 0,
            unit: "usd",
          })
        }
        active.agentStarted += 1
        // Task 15: snapshot the active per-phase default model SYNCHRONOUSLY here
        // (alongside `node.phase`), not inside the dispatched gen — concurrent
        // parallel/pipeline steps may move the phase before this fiber runs, so
        // capturing it at call time keeps each step bound to the phase it was
        // dispatched under (matching how `node.phase` snapshots current_phase).
        //
        // Item 16: an EXPLICIT per-call phase uses ITS declared model (or none) —
        // never the global current phase's model: the author pinned this step to a
        // phase, so the global default would be the wrong phase's model.
        const phaseModel = agentInput.phase !== undefined ? callOpts?.phaseModel : active.currentPhaseModel
        const node: AgentRun = {
          id: `${active.run.agents.length + 1}`,
          status: "running",
          started_at: Date.now(),
          // Item 16: a per-call phase (already logPrefix-ed by createContext) pins
          // the node; otherwise the node snapshots the run's current phase.
          phase: agentInput.phase ?? active.run.current_phase,
          agent: agentInput.agent,
          label: agentInput.label,
          model: agentInput.model,
          prompt: agentInput.prompt,
        }
        active.run.agents.push(node)
        persistInScope(active, bridge, db, events)
        // Finding 2: an externally-aborted subagent (a session abort/timeout that is
        // NOT a run-level cancel/pause) RESOLVES with an abort-marked assistant
        // message that carries the abort-artifact cost. That cost must NOT be charged
        // to the budget/costSpent (the comment in the `ensuring` below says so), but
        // the run-level flags it gated on (cancelling/removed/pausing) are all false
        // in this case. We capture `aborted` at the abort-detection point so the
        // `ensuring` settlement can skip the charge for it too. Lives in the handler
        // scope (shared by the gen and its `ensuring`).
        let aborted = false
        return dispatch(
          Effect.gen(function* () {
            const selected = agentInput.agent ? yield* agents.get(agentInput.agent) : yield* agents.defaultInfo()
            // Model resolution (precedence, highest first):
            //   1. EXPLICIT per-call `agentInput.model` — including the magic
            //      `model: "small"`, which routes to the configured `small_model`
            //      (read from the already-injected Config.Service). Requesting
            //      "small" with no `small_model` configured is an authoring error
            //      (fail the step, never silently fall back).
            //   2. The active PHASE'S default `model` (Task 15) — captured at call
            //      time as `phaseModel`; used only when the call gave no explicit
            //      model, so an explicit model always wins over the phase default.
            //   3. The CALLER session's resolved model (Item 12) — DEFAULT-agent
            //      steps only (`!agentInput.agent`): an explicitly chosen agent is
            //      a deliberate authoring decision including its model, while the
            //      default-agent step should follow the main loop's model.
            //      `caller_model` arrives pre-parsed ({providerID, modelID}), so it
            //      is used as-is, never re-run through Provider.parseModel.
            //   4. The selected agent's own model.
            const smallModel = agentInput.model === "small" ? (yield* config.get()).small_model : undefined
            if (agentInput.model === "small" && !smallModel) {
              return yield* new InvalidError({
                path: active.run.workflow,
                message: 'ctx.agent({ model: "small" }) requires "small_model" to be configured',
              })
            }
            const modelInfo = smallModel
              ? Provider.parseModel(smallModel)
              : agentInput.model
                ? Provider.parseModel(agentInput.model)
                : phaseModel
                  ? Provider.parseModel(phaseModel)
                  : !agentInput.agent && active.callerModel
                    ? // Pre-parsed components are only re-BRANDED here (plain
                      // brands, no refinement): model ids legitimately contain
                      // slashes, so the joined string must never go back through
                      // Provider.parseModel.
                      {
                        providerID: ProviderV2.ID.make(active.callerModel.providerID),
                        modelID: ModelV2.ID.make(active.callerModel.modelID),
                      }
                    : selected.model
            // OTel: enrich the enclosing `workflow.agent` span with the RESOLVED
            // agent name and model now that both are known (the boundary above set
            // only the static/requested attributes). Purely observational.
            yield* Effect.annotateCurrentSpan({
              "workflow.agent.name": selected.name,
              ...(modelInfo ? { "workflow.agent.model": `${modelInfo.providerID}/${modelInfo.modelID}` } : {}),
            })
            // Per-step model reasoning variant (e.g. "max"). opencode keeps the
            // variant SEPARATE from the model ref (model ids legitimately contain
            // slashes, so it is never peeled from the model string here — that is
            // the registry-aware job of the model picker); it rides alongside the
            // model into both the child session and the prompt run.
            const variant = agentInput.variant
            // Per-step skills (Task 9). opencode has NO structured "give this
            // session these skills" field: skills are only loadable at runtime via
            // the `skill` tool (which asks for the `skill` permission and injects
            // the skill content into the conversation). So the supported mechanism
            // is a documented prompt convention — prepend a directive naming the
            // requested skills and ENABLE the `skill` tool for the step (folded
            // into the per-step tools scoping above). The directive precedes the
            // author's prompt so the model loads the skills before starting.
            const skills = agentInput.skills?.filter((s) => s.length > 0) ?? []
            // Prompt assembly (in order): the step-framing directive (NON-schema
            // steps only — see STEP_FRAMING_DIRECTIVE), the skills directive, then
            // the author's prompt. Only the DISPATCHED text is framed: `node.prompt`
            // keeps the raw `agentInput.prompt` (set at node creation above), and
            // the resume journalKey builds on agentInput.prompt too — so framing
            // never breaks existing resume journals or the journal shape match
            // (the skills directive has relied on the same split all along).
            const promptText = [
              agentInput.schema ? undefined : STEP_FRAMING_DIRECTIVE,
              skills.length > 0 ? `Load these skills before starting: ${skills.join(", ")}.` : undefined,
              agentInput.prompt,
            ]
              .filter(Boolean)
              .join("\n\n")
            const tools = skills.length > 0 ? { ...(agentInput.tools ?? {}), skill: true } : agentInput.tools
            // Declarative file attachments (Task 10). Each path is resolved
            // RELATIVE TO the run's workspace directory (`active.directory`, the
            // InstanceState directory the run was started in) and must exist —
            // a missing attachment is an authoring error, so fail the step with a
            // clear WorkflowInvalidError naming the file (before any prompt is
            // dispatched) rather than sending a broken prompt. Each resolved file
            // becomes a `text/plain` FilePartInput whose `url` is the absolute
            // `file://` URL; the prompt loop reads `file://` parts off disk (via
            // the Read tool) exactly like a TUI-attached file. Built here so the
            // parts can be appended AFTER the text part below.
            const fileParts: { type: "file"; mime: string; filename: string; url: string }[] = []
            for (const file of agentInput.files ?? []) {
              if (file.length === 0) continue
              const resolved = path.isAbsolute(file) ? file : path.resolve(active.directory, file)
              // Must exist AND be a regular file: a directory is not an attachable
              // source, so it fails here cleanly rather than being sent as a broken
              // `file://` part (matches the prior `Bun.file(dir).exists()` -> false).
              const exists = yield* Effect.promise(() =>
                fs
                  .stat(resolved)
                  .then((s) => s.isFile())
                  .catch(() => false),
              )
              if (!exists) {
                return yield* new InvalidError({
                  path: active.run.workflow,
                  message: `ctx.agent file attachment not found: ${file} (resolved to ${resolved})`,
                })
              }
              fileParts.push({
                type: "file",
                mime: "text/plain",
                filename: path.basename(resolved),
                url: pathToFileURL(resolved).href,
              })
            }
            // Resume replay: when this run has a journal (started with
            // resume_of), consume the next unused source agent for this call's
            // key (occurrence order) and replay it verbatim — NO session, NO
            // prompt. The node adopts the source output/cost/tokens, is marked
            // `cached`, and the replayed cost is charged once via the shared
            // `ensuring` (post-step) — the SAME decrement the live-step path uses;
            // the budget gate before this lookup still fails honestly when
            // exhausted. `structured` is re-parsed from the stored output when a
            // schema was requested so `result.data` stays the parsed object,
            // identical to a live structured step. A miss falls through to the
            // live path below. The agent name is resolved (`selected.name`)
            // exactly like the seed side, so a default-agent call still matches.
            // Item 20: both replay modes resolve a CANDIDATE here and share the
            // verbatim-replay block below; `commitReplay` advances the mode's
            // own cursor only once the hit is final (the schema parse guard may
            // still veto it).
            // - prefix (default): the next entry of the ORDERED source sequence
            //   must match this call — entry exists, source node completed, its
            //   index not invalidated, and the journal key equal. ANY mismatch
            //   breaks the prefix PERMANENTLY (replayBroken): every later call
            //   runs live, even an unchanged one, because its workspace side
            //   effects may be stale after the changed step.
            // - keyed: the previous shape-matching behavior 1:1 (occurrence
            //   cursor per key; a miss falls through to live without breaking
            //   anything).
            let replayCached: AgentRun | undefined
            let commitReplay: (() => void) | undefined
            if (active.journalMode === "prefix" && active.journalSeq && !active.replayBroken) {
              const entry = active.journalSeq[active.journalSeqCursor]
              const liveKey = journalKey({ prompt: agentInput.prompt, agent: selected.name, phase: node.phase })
              const matches =
                entry !== undefined &&
                entry.node.status === "completed" &&
                !(active.invalidateSet?.has(entry.index) ?? false) &&
                journalKey({ prompt: entry.node.prompt, agent: entry.node.agent, phase: entry.node.phase }) === liveKey
              if (matches) {
                replayCached = entry.node
                commitReplay = () => {
                  active.journalSeqCursor += 1
                }
              } else {
                active.replayBroken = true
              }
            } else if (active.journal && active.journalCursor) {
              const key = journalKey({ prompt: agentInput.prompt, agent: selected.name, phase: node.phase })
              const bucket = active.journal.get(key)
              const cursor = active.journalCursor.get(key) ?? 0
              const cached = bucket?.[cursor]
              if (cached) {
                replayCached = cached
                commitReplay = () => {
                  active.journalCursor!.set(key, cursor + 1)
                }
              }
            }
            if (replayCached !== undefined && commitReplay !== undefined) {
              const cached = replayCached
              // A schema was requested ⇒ the replayed output must parse as JSON
              // to satisfy `result.data`. The source node may be a PLAINTEXT
              // agent whose journal key happens to match this schema call (the
              // workflow FILE drifted between the original run and the resume:
              // same prompt/agent/phase, but the agent now asks for a schema).
              // `JSON.parse` on that plaintext would throw SYNCHRONOUSLY and
              // turn into a defect. Guard it with `Effect.try` captured as an
              // `Effect.exit` (engine style; no try/catch). On a parse FAILURE
              // we treat the lookup as a cache MISS — semantically correct: the
              // cache cannot serve this schema, so we DON'T consume the journal
              // entry, fall through, and let the agent run live (which yields a
              // real structured result). Only commit the cache hit once we know
              // the parse succeeded. Item 20: in PREFIX mode a parse failure
              // additionally breaks the prefix permanently (the cache no longer
              // fits this call semantically — the script drifted), instead of a
              // silent per-call fall-through.
              const parsedExit =
                agentInput.schema && cached.output !== undefined
                  ? yield* Effect.try({
                      try: () => JSON.parse(cached.output!) as unknown,
                      catch: (error) => (error instanceof Error ? error.message : String(error)),
                    }).pipe(Effect.exit)
                  : undefined
              const parseFailed = parsedExit !== undefined && Exit.isFailure(parsedExit)
              if (parseFailed && active.journalMode === "prefix") {
                active.replayBroken = true
              }
              if (!parseFailed) {
                commitReplay()
                node.agent = selected.name
                node.status = "completed"
                node.completed_at = Date.now()
                node.output = cached.output
                node.cost = cached.cost
                node.tokens = cached.tokens
                node.model = cached.model
                node.cached = true
                // The budget decrement is left to the shared `ensuring` below
                // (node.cost is set), so a cache hit is charged exactly once.
                yield* persistRun(db, events, active)
                const structured = parsedExit !== undefined ? parsedExit.value : undefined
                return {
                  data: structured !== undefined ? structured : (cached.output ?? ""),
                  text: cached.output ?? "",
                }
              }
            }
            // Nested subagents (design-final §4.7 / Ü4): the agent session is
            // created with `parentID = run.session_id` below, so it occupies a
            // REAL nesting level and the workflow tool is no ladder past the
            // depth limit. The child's depth derives from the run session's
            // actual parent chain; without a run session (purely programmatic
            // start) the agent session is a root (depth 1). A failed walk
            // (cyclic parents, SubagentLineageError) fails the step like a
            // depth violation — node `failed`, the same error path as
            // AgentLimitError. The guard sits BEFORE sessions.create (and
            // before the worktree setup), so a refused dispatch creates
            // nothing and wastes no turn.
            const depthLimit = SubagentLimits.maxDepth(yield* config.get())
            const runChain = active.run.session_id
              ? yield* sessions.lineage(SessionID.make(active.run.session_id)).pipe(
                  // An unknown run session is an orphan, and orphans are roots.
                  Effect.catchTag("NotFoundError", () => Effect.succeed([])),
                )
              : []
            const childDepth = runChain.length + 1
            if (childDepth > depthLimit) {
              return yield* SubagentLimits.depthError({ depth: runChain.length, limit: depthLimit })
            }
            // Security (#26514 regression, Fund N9): a workflow subagent MUST
            // inherit the caller's deny/external_directory rules — exactly like
            // the task tool derives a subagent's ruleset (since #31696 parent
            // AGENT restrictions are deliberately NOT inherited; the subagent's
            // own permissions determine its capabilities). Without the caller's
            // identity (a purely programmatic/HTTP start with no session) we fall
            // back to the prior behavior: no inherited ruleset (the engine still
            // defaults the todowrite deny for any non-permitting subagent via
            // the normal session permission path).
            const callerSession = input.caller
              ? yield* sessions.get(input.caller.sessionID).pipe(Effect.catchCause(() => Effect.succeed(undefined)))
              : undefined
            // The inherited subagent ruleset: parent session denies/external_directory,
            // default todowrite deny, plus the depth-gated task/workflow denies
            // for a child AT the limit. Absent a caller identity there is
            // nothing to inherit (prior fallback).
            const derivedPermission = callerSession
              ? deriveSubagentSessionPermission({
                  parentSessionPermission: callerSession.permission ?? [],
                  subagent: selected,
                  childDepth,
                  maxDepth: depthLimit,
                })
              : undefined
            // Security (compose, never override): per-step tool scoping must NEVER
            // re-grant a tool the inherited ruleset denies. The Record→rules
            // conversion mirrors the prompt loop's (PromptInput.tools handler):
            // each entry → `{ permission, action: allow|deny, pattern: "*" }`.
            // When an inherited ruleset exists we MUST NOT route `tools` through
            // PromptInput.tools, whose handler does a FULL ASSIGNMENT
            // (`session.permission = [tools→rules]`) that would clobber the derived
            // denies for the step. Instead we COMPOSE: the per-step rules go FIRST,
            // the derived ruleset LAST. The permission engine is last-match-wins
            // (`evaluate` = `.flat().findLast(...)`), so an inherited deny always
            // beats a per-step grant of the same permission, while a per-step DENY
            // (scoping down) and grants of non-denied tools still take effect. When
            // there is no inherited ruleset there is nothing to clobber, so we keep
            // routing `tools` through PromptInput.tools below (createPermission stays
            // undefined and `tools` is passed to prompt.prompt).
            const toolRules = Object.entries(tools ?? {}).map(([t, enabled]) => ({
              permission: t,
              action: enabled ? ("allow" as const) : ("deny" as const),
              pattern: "*" as const,
            }))
            const composeTools = derivedPermission !== undefined && toolRules.length > 0
            const createPermission = composeTools ? [...toolRules, ...derivedPermission!] : derivedPermission
            // Per-step git-worktree isolation (Task 11). When requested, run the
            // subagent inside a FRESH `git worktree` so parallel agents that
            // mutate files cannot conflict. The worktree is created off the run's
            // workspace (`active.directory`) and removed when the run finishes or
            // is cancelled — the remove finalizer is registered on the RUN scope
            // (this effect runs via dispatch → `Effect.forkIn(effect, runScope)`,
            // so the finalizer attaches there, survives parallel steps, and fires
            // on cancel). A non-git workspace cannot host a worktree, so the step
            // fails with a clear WorkflowInvalidError instead of crashing.
            //
            // The isolation is load-bearing via the `InstanceRef` override below,
            // NOT the session's `directory` field: the subagent's file tools
            // (bash/edit/write/read) and the prompt loop resolve their cwd from
            // the effective `InstanceState.context` (the `InstanceRef`), not from
            // `session.directory`. So we both (a) override `InstanceRef` for the
            // prompt run (what actually redirects the tools) and (b) record the
            // worktree as the session's `directory` so the dashboard reflects
            // where the work happened.
            const instanceCtx = yield* InstanceState.context
            let promptInstanceCtx = instanceCtx
            let sessionDirectory = instanceCtx.directory
            if (agentInput.isolation === "worktree") {
              // Finding 3: do NOT use a predictable, world-readable path under the
              // shared tmp root (`os.tmpdir()/oc-wf-<runid>-<nodeid>`). Both run.id
              // (monotonic, returned verbatim by the API/events) and node.id (a
              // sequential counter) are guessable, so on a multi-user host any local
              // user could read the full checkout + any secrets the subagent writes.
              // Mint a private base via `fs.mkdtemp` (random, unguessable suffix) and
              // chmod it 0700 so only the running user can traverse it; the empty
              // mkdtemp dir is a valid `git worktree add` target. The `WORKTREE_PREFIX`
              // is shared with the startup orphan sweep so a SIGKILLed run's leaked
              // worktree is reclaimed on next start.
              const base = yield* Effect.promise(() => fs.mkdtemp(path.join(os.tmpdir(), WORKTREE_PREFIX)))
              yield* Effect.promise(() => fs.chmod(base, 0o700)).pipe(Effect.ignore)
              const res = spawnSync("git", ["worktree", "add", "--detach", base], { cwd: instanceCtx.directory })
              if (res.status !== 0) {
                // node's spawnSync reports the exit code on `status` (not `exitCode`);
                // on a spawn failure (e.g. git not on PATH) `status` is null and the
                // reason is on `res.error`, with `stderr` possibly null — surface
                // whichever is present so the message is never empty.
                const detail = res.stderr ? new TextDecoder().decode(res.stderr) : (res.error?.message ?? "")
                // The mkdtemp dir is orphaned when `git worktree add` fails (e.g. a
                // non-git workspace); remove it so a failed isolation request does
                // not leak an empty private dir into tmp.
                yield* Effect.promise(() => fs.rm(base, { recursive: true, force: true })).pipe(Effect.ignore)
                return yield* new InvalidError({
                  path: active.run.workflow,
                  message: `ctx.agent isolation:"worktree" requires a git repository (${detail.trim()})`,
                })
              }
              // Item 7: capture the worktree's base commit so the finalizer can
              // tell "new commits were made here" apart from "unchanged". A
              // rev-parse failure leaves baseRef undefined — then only the dirty
              // check decides.
              const baseHead = spawnSync("git", ["rev-parse", "HEAD"], { cwd: base })
              const baseRef = baseHead.status === 0 ? baseHead.stdout.toString().trim() : undefined
              // Cleanup on the RUN scope: survives parallel steps, fires on
              // cancel/finish. Register EXPLICITLY on `active.runScope` rather
              // than via `Effect.addFinalizer` (which targets the ambient Scope):
              // this effect is forked via `Effect.forkIn(effect, runScope)`, which
              // SUPERVISES the fiber under the run scope but does NOT provide that
              // scope as the `Scope` service in context — so an ambient
              // `addFinalizer` would attach to the wrong (or no) scope. Targeting
              // the run scope object directly guarantees the finalizer runs
              // exactly once when the run terminates (finish closes runScope) or
              // is cancelled/removed (abortRun closes it), never per step.
              //
              // Item 7: only an UNCHANGED worktree is removed. A worktree with
              // uncommitted changes OR new commits (not merged back to the main
              // tree) is PRESERVED — including its git registration, so
              // `git worktree list` still shows it — and the preserve is logged
              // with the path. A git-status failure is conservatively treated as
              // dirty (better to preserve than to lose data).
              yield* Scope.addFinalizer(
                active.runScope,
                Effect.gen(function* () {
                  const status = spawnSync("git", ["status", "--porcelain"], { cwd: base })
                  const dirty = status.status !== 0 || status.stdout.toString().trim().length > 0
                  const head = spawnSync("git", ["rev-parse", "HEAD"], { cwd: base })
                  const moved = baseRef !== undefined && head.status === 0 && head.stdout.toString().trim() !== baseRef
                  if (!dirty && !moved) {
                    spawnSync("git", ["worktree", "remove", "--force", base], { cwd: instanceCtx.directory })
                    // `git worktree remove` deletes the worktree dir on success;
                    // force a recursive rm as a backstop so the private base never
                    // lingers even if the git removal was partial. Runs ONLY on the
                    // unchanged branch — a preserved worktree is never rm'd.
                    yield* Effect.promise(() => fs.rm(base, { recursive: true, force: true })).pipe(Effect.ignore)
                    return
                  }
                  // Marker file so the startup orphan sweep (sweepWorktrees) skips
                  // this deliberately-preserved dir even past its age cutoff.
                  yield* Effect.promise(() => fs.writeFile(path.join(base, WORKTREE_PRESERVED_MARKER), "")).pipe(
                    Effect.ignore,
                  )
                  active.run.logs.push({
                    time: Date.now(),
                    message: `worktree preserved at ${base}: ${dirty ? "uncommitted changes" : "new commits"}`,
                  })
                  // On the normal finish path the runScope closes AFTER the
                  // terminal persist, so this write emits a SECOND finished event
                  // (persistRun picks the event by status). The TUI notification
                  // dedupes per run id and the app merely refetches — accepted.
                  // On cancel, abortRun closes the scope BEFORE finish, so the log
                  // rides the regular terminal persist. For a removed run,
                  // persistRun no-ops (tombstone) — the worktree stays preserved
                  // anyway (files > run row).
                  yield* persistRun(db, events, active).pipe(Effect.ignore)
                }),
              )
              // A fresh worktree is a self-contained working tree, so both the
              // working directory AND the worktree root point at `base`.
              promptInstanceCtx = { ...instanceCtx, directory: base, worktree: base }
              sessionDirectory = base
              // Item 7: record the work location on the node (persisted by the
              // existing persistRun after session creation below).
              node.worktree = base
            }
            const session = yield* sessions.create({
              parentID: active.run.session_id ? SessionID.make(active.run.session_id) : undefined,
              title: `${active.run.workflow} ${node.id} (@${selected.name} subagent)`,
              agent: selected.name,
              model: modelInfo ? { id: modelInfo.modelID, providerID: modelInfo.providerID, variant } : undefined,
              permission: createPermission,
              directory: sessionDirectory,
            })
            node.agent = selected.name
            if (modelInfo) node.model = `${modelInfo.providerID}/${modelInfo.modelID}`
            node.session_id = session.id
            // Track the child session so cancel()/remove() can abort it.
            active.sessions.add(session.id)
            // Fund 16: a cancel may have landed in the window between the start
            // gate above and registering this session. Self-abort the freshly
            // created session if so, instead of relying on a one-shot snapshot
            // in abortRun that could miss it. The scope-close path will also
            // interrupt this fiber, but aborting the session here stops the
            // model spend deterministically and is idempotent.
            if (active.cancelling || active.removed) {
              if (active.cancelSession) yield* active.cancelSession(session.id).pipe(Effect.ignore)
            }
            yield* persistRun(db, events, active)
            // Item 15: a skip that landed BEFORE this step's session was
            // registered (skipAgent had no session_id to abort yet) is caught
            // here, right before the prompt would dispatch — the step never
            // spends and resolves null via the SKIPPED settlement below.
            if (active.skipRequests.has(node.id)) {
              node.status = "skipped"
              node.completed_at = Date.now()
              yield* persistRun(db, events, active)
              return SKIPPED
            }
            // Item 28: subagent sessions load MCP tools LAZILY by default —
            // they start with only the tool_search meta-tool instead of every
            // MCP schema, the context-economy win for short-lived workflow
            // steps. Configurable off via workflows.lazy_mcp=false; the main
            // session loop stays eager (no `mcp` field there).
            const lazyMcp = (yield* config.get()).workflows?.lazy_mcp !== false
            const message = yield* prompt
              .prompt({
                sessionID: session.id,
                permissionSessionID: agentInput.permissionSessionID ?? input.permissionSessionID,
                agent: selected.name,
                model: modelInfo,
                variant,
                mcp: lazyMcp ? ("lazy" as const) : undefined,
                // Per-step tool scoping: opencode's `Record<string, boolean>`
                // whitelist/blacklist (glob-able keys, e.g. `{ webfetch: false }`)
                // lives on PromptInput.tools (NOT sessions.create — that only takes a
                // permission Ruleset). The prompt loop folds each entry into an
                // allow/deny session permission rule, so threading it here scopes the
                // child session's tools for this step. `tools` already merges the
                // step's own scoping with the `skill: true` enablement that the
                // skills directive (above) requires.
                //
                // BUT the prompt loop's handler does a FULL ASSIGNMENT that would
                // clobber an inherited subagent ruleset. So when we already composed
                // the per-step rules INTO the child session's permission at creation
                // (an inherited ruleset existed — `composeTools`), we must NOT pass
                // `tools` here, or it would overwrite that composed ruleset and drop
                // the inherited denies. Only route through PromptInput.tools when there
                // was nothing to inherit/clobber.
                tools: composeTools ? undefined : tools,
                format: agentInput.schema ? { type: "json_schema", schema: agentInput.schema } : undefined,
                // `promptText` is the author's prompt, optionally prefixed with the
                // per-step skill-load directive (see the `skills` resolution above).
                // Declarative file attachments (Task 10) follow the text part, in the
                // order they were declared.
                parts: [{ type: "text", text: promptText }, ...fileParts],
                // Worktree isolation (Task 11): override the effective InstanceRef
                // for the subagent's prompt run so its file tools resolve cwd
                // against the worktree, not the run's workspace. `InstanceRef` is a
                // Context.Reference (innermost-wins), so this local provide beats
                // the run-level one attached at the dispatch boundary. When isolation
                // is off, `promptInstanceCtx === instanceCtx` so this is the prior
                // (effectively no-op) provide of the same ref value.
              })
              .pipe(Effect.provideService(InstanceRef, promptInstanceCtx))
            node.message_id = message.info.id
            if (message.info.role === "assistant") {
              node.model = `${message.info.providerID}/${message.info.modelID}`
              // `prompt.prompt` is an agentic while(true) loop (SessionPrompt.runLoop):
              // a single ctx.agent step that uses tools persists MANY assistant
              // messages (one per turn), each with its own per-turn `cost`/`tokens`,
              // but only ever RETURNS the LAST one. Charging just `message.info.cost`
              // therefore discards every intermediate turn's spend — the dashboard
              // under-reports and the budget under-counts massively (Fund N12). Sum
              // cost/tokens over ALL assistant messages of this child session instead.
              // `sessions.messages` returns the raw per-message list (NOT a cumulative
              // pre-aggregate), so summing it cannot double-count; the returned
              // `message` is itself one of those persisted rows, so it is NOT added on
              // top. A single-turn session yields exactly one assistant message ⇒ the
              // sum equals that message ⇒ identical to the prior single-message read.
              const assistants = (yield* sessions.messages({ sessionID: session.id }).pipe(Effect.orDie))
                .map((m) => m.info)
                .filter((info) => info.role === "assistant")
              node.cost = assistants.reduce((sum, info) => sum + info.cost, 0)
              // Keep `total` optional exactly as the per-message tokens schema has it:
              // only emit a summed total when at least one message actually carried one,
              // otherwise leave it `undefined` so a single-message session is byte-for-byte
              // identical to the prior `node.tokens = message.info.tokens` assignment.
              const totals = assistants.map((info) => info.tokens.total).filter((t) => t !== undefined)
              node.tokens = assistants.reduce(
                (acc, info) => ({
                  total: acc.total,
                  input: acc.input + info.tokens.input,
                  output: acc.output + info.tokens.output,
                  reasoning: acc.reasoning + info.tokens.reasoning,
                  cache: {
                    read: acc.cache.read + info.tokens.cache.read,
                    write: acc.cache.write + info.tokens.cache.write,
                  },
                }),
                {
                  total: totals.length > 0 ? totals.reduce((sum, t) => sum + t, 0) : undefined,
                  input: 0,
                  output: 0,
                  reasoning: 0,
                  cache: { read: 0, write: 0 },
                } as NonNullable<AgentRun["tokens"]>,
              )
            }
            // Fund 4: the production runner RESOLVES (does not reject) when a
            // session is aborted — it returns the last assistant message, which
            // carries an abort/cancelled error. If the run is cancelling/removed
            // OR the message itself is abort-marked, this step did not succeed:
            // fail it as cancelled so the body unwinds as `cancelled` and the
            // settlement callbacks below never flip the node to `completed`.
            aborted = isAbortedMessage(message)
            // Item 15: an abort caused by a SKIP request (skipAgent aborted this
            // node's session, no run-level cancel/pause in flight) settles the
            // step as `skipped` and resolves null — checked BEFORE the cancel
            // branch below. A prompt that resolved NORMALLY before the abort
            // landed (aborted === false) keeps its result: the skip came too
            // late. Budget: aborted === true ⇒ the ensuring below skips the
            // charge, so skip-artifact cost is never billed.
            if (
              aborted &&
              active.skipRequests.has(node.id) &&
              !active.cancelling &&
              !active.removed &&
              !active.pausing
            ) {
              node.status = "skipped"
              node.completed_at = Date.now()
              node.output = undefined
              yield* persistRun(db, events, active)
              return SKIPPED
            }
            if (active.cancelling || active.removed || aborted) {
              return yield* Effect.die(new CancelledError())
            }
            const structured = message.info.role === "assistant" ? message.info.structured : undefined
            // A schema was requested ⇒ a structured result is mandatory. When the
            // session produced none (it set a StructuredOutputError on the message
            // and/or `structured` came back undefined) we MUST fail the step rather
            // than silently fall back to plaintext: a missing structured result is
            // a genuine step failure that has to surface (node `failed`, run fails
            // unless the module catches it). Non-schema agents are unaffected.
            if (agentInput.schema && structured === undefined) {
              const sessionMessage =
                message.info.role === "assistant" && message.info.error?.name === "StructuredOutputError"
                  ? message.info.error.data.message
                  : undefined
              node.output = assistantText(message)
              const schemaText = JSON.stringify(agentInput.schema)
              return yield* new StructuredOutputError({
                message: [
                  "Agent was asked for structured output but produced none",
                  sessionMessage ? `(${sessionMessage})` : undefined,
                  `expected a result matching the requested schema (${schemaText.length > 200 ? schemaText.slice(0, 200) + "…" : schemaText})`,
                ]
                  .filter(Boolean)
                  .join(" "),
              })
            }
            node.output = structured !== undefined ? JSON.stringify(structured, null, 2) : assistantText(message)
            return {
              data: structured !== undefined ? structured : node.output,
              text: node.output,
            }
          }).pipe(
            Effect.ensuring(
              Effect.sync(() => {
                if (node.session_id) active.sessions.delete(node.session_id)
                // Item 24: settle the pool reservation FIRST — before the
                // cancelled/paused early-return below — because settle must run
                // on EVERY outcome (ensuring semantics): it releases the
                // reserved headroom even when the charge is skipped, so a
                // reservation can never leak. An aborted/cancelled/paused step
                // settles with 0 (its cost is the abort artifact, not real
                // spend — same rule as the run-budget charge below); any other
                // outcome commits the step's actual cost/tokens and advances
                // the rolling per-step estimate.
                if (poolReservation && active.pool) {
                  const skipCharge = active.cancelling || active.removed || active.pausing || aborted
                  TurnBudget.settle(active.pool, poolReservation, {
                    usd: skipCharge ? 0 : (node.cost ?? 0),
                    tokens: skipCharge ? 0 : node.tokens ? node.tokens.output + node.tokens.reasoning : 0,
                  })
                }
                // Decrement the live budget by whatever this step ACTUALLY cost
                // — the SAME `cost` (USD) the dashboard shows, set on the node
                // from the assistant message above. Done in `ensuring` (not the
                // success branch) so failed-but-paid steps (e.g. a structured-
                // output failure that still incurred model cost) are charged too.
                // EXCEPT a cancelled run: an abort-resolved step did not produce
                // a real result and must not be charged (Fund 4) — and any cost
                // on an aborted message is the abort artifact, not real spend.
                // A step with no cost leaves the budget untouched; unset stays Infinity.
                // A pausing run is treated like a cancelling one: an interrupted
                // step did not really spend, so it must not be charged.
                // Finding 2: ALSO skip when the resolved message was abort-marked
                // (`aborted`), even with NO run-level flag set — an externally
                // aborted subagent's cost is the abort artifact, not real spend, so
                // charging it would leave a `cancelled` run with a debited budget.
                if (active.cancelling || active.removed || active.pausing || aborted) return
                // Charge the SAME cost to BOTH the live remaining budget (gated)
                // and the lifetime spend accumulator. costSpent accrues regardless
                // of whether a budget was set, so `ctx.budget.spent()` works without
                // a budget; keeping it on the same guard/cost as `budgetRemaining`
                // makes `spent()`/`remaining()`/`total` mutually consistent.
                active.budgetRemaining -= node.cost ?? 0
                active.costSpent += node.cost ?? 0
                // Item 17: token accounting at the SAME site, under the SAME
                // guards. Counted: output + reasoning (reasoning is output-billed
                // — the original counts the turn's output tokens); input/cache
                // deliberately NOT counted. Journal replays charge automatically
                // (node.tokens is copied on a cache hit before this runs).
                active.tokensSpent += node.tokens ? node.tokens.output + node.tokens.reasoning : 0
              }),
            ),
            // Run-wide concurrency cap (Spec §5.1): acquire one permit around
            // the whole dispatch so at most `agentConcurrencyCap()` ctx.agent
            // steps run at once across the entire run, no matter how generous a
            // per-call `concurrencyLimit` is. The permit is released on success,
            // failure, OR interruption (withPermits semantics), so a cancelled
            // step never leaks a permit. A journal replay returns early and so
            // holds the permit only momentarily.
            active.agentSemaphore.withPermits(1),
            // OTel: each ctx.agent dispatch gets a `workflow.agent` span (the
            // engine had no agent-level spans before). Static attributes are set
            // here at construction time; the RESOLVED agent name and model are
            // only known once `selected`/`modelInfo` are computed inside the gen,
            // so they are added there via `Effect.annotateCurrentSpan`. Dotted
            // lowercase keys match the repo convention (tool.name/session.id …);
            // the span is purely observational and changes no behavior.
            Effect.withSpan("workflow.agent", {
              attributes: {
                "workflow.run_id": active.run.id,
                "workflow.agent.id": node.id,
                "workflow.phase": node.phase ?? undefined,
                // Requested (pre-resolution) agent/model, useful even on a step
                // that fails before resolution. The resolved values are annotated
                // onto this same span once known (see the gen body above).
                ...(agentInput.agent ? { "workflow.agent.requested": agentInput.agent } : {}),
                ...(agentInput.model ? { "workflow.agent.model_requested": agentInput.model } : {}),
              },
            }),
          ),
        ).then(
          (result) => {
            // Item 15: a skipped step resolves `null` — BEFORE the terminal
            // settlement guard below (the run may legitimately finish while the
            // skip settles) and without a second persist (the dispatch gen
            // already persisted the node's `skipped` state).
            if (result === SKIPPED) return null
            // Settlement guard (Fund 4): once the run is cancelling/pausing/
            // removed or already terminal, the success branch is a NO-OP for the
            // node and emits NO further write. Otherwise a resolve-on-abort step
            // (the production runner resolves on abort) would flip a cancelled/
            // paused node to `completed` and re-persist after the terminal write.
            if (active.cancelling || active.pausing || active.removed || active.run.status !== "running") {
              throw new CancelledError()
            }
            node.status = "completed"
            node.completed_at = Date.now()
            node.output = result.text
            persistInScope(active, bridge, db, events)
            return result
          },
          (error) => {
            // Same guard on the failure path: do not mutate/persist the node
            // for a run that has already moved to (or is moving to) terminal/
            // paused — finish() owns the node's terminal state in that case.
            if (active.cancelling || active.pausing || active.removed || active.run.status !== "running") {
              return Promise.reject(error)
            }
            node.status = "failed"
            node.completed_at = Date.now()
            node.error = errorText(error)
            persistInScope(active, bridge, db, events)
            return Promise.reject(error)
          },
        )
      }

      // Item 15 (onError:"null"): the public agent vector. A FINAL catch over the
      // whole step (gates included — the failure settlement above has already
      // recorded the node as `failed` with its error by the time it fires):
      // with `onError: "null"` a failing step resolves `null` so the body can
      // branch instead of unwinding. Budget/lifetime gates and aborts are NEVER
      // swallowed (excluded below) — silently nulling those inside a while-loop
      // would spin forever against an exhausted budget or a cancelled run.
      const agent = (agentInput: AgentInput, callOpts?: { phaseModel?: string }) =>
        agentStep(agentInput, callOpts).catch((error) => {
          if (
            agentInput.onError === "null" &&
            !(error instanceof CancelledError) &&
            !(error instanceof BudgetExceededError) &&
            !(error instanceof AgentLimitError) &&
            // The depth gate is deterministic for the whole run (every
            // dispatch from the same run session fails the same way), so
            // nulling it inside a while-loop would spin forever — same
            // rationale as the lifetime/budget gates above.
            !(error instanceof SubagentLimits.SubagentDepthError)
          ) {
            return null
          }
          throw error
        })

      // Deterministic non-LLM step. Runs a shell command in the run's workspace
      // (or an explicit `cwd`) and resolves to `{ output, exitCode }` WITHOUT
      // touching `costSpent`/budget or starting an agent — it deliberately does
      // NOT go through `agent()`, the budget gate, or the lifetime cap. The work
      // runs as a child of the run scope (via `dispatch`), so a cancel/remove that
      // closes the run scope interrupts an in-flight shell; a `checkpoint()`-style
      // guard before dispatch refuses to start a new shell once a cancel/pause has
      // landed. A non-zero exit is returned (`nothrow`), never thrown.
      const shell: ContextApi["shell"] = (command, opts) => {
        if (runSignal?.aborted || active.cancelling || active.pausing || active.removed) throw new CancelledError()
        const cwd = opts?.cwd ?? active.directory
        return dispatch(
          Effect.gen(function* () {
            const cfg = yield* config.get()
            const sh = Shell.preferred(cfg.shell)
            // Item 23 (Stufe 1): permission gate, the FIRST step inside the
            // dispatched effect (so a cancel/pause that closes the run scope
            // interrupts an OPEN ask cleanly — same unwind as a hung agent).
            // The scan reuses the bash tool's exact pattern derivation
            // (scanCommand), so the user's `bash` allow/deny rules (e.g.
            // 'git status*') apply identically; out-of-workspace paths get the
            // same external_directory ask the bash tool raises. The asks are
            // evaluated against the run's caller-inherited ruleset and surface
            // on permissionSessionID (or the run's own session for headless
            // starts, identical to subagent tool asks). Kill-switch: config
            // workflows.shell_permission=false restores the ungated behavior.
            // A deny/reject propagates like a step failure — mapped to a clear
            // error naming the command, so the run's error is self-explanatory.
            // ctx.shell is not journaled, so the gate fires again on every
            // resume.
            if (cfg.workflows?.shell_permission !== false) {
              const instanceCtx = yield* InstanceState.context
              const scan = yield* scanCommand(command, cwd, instanceCtx, sh).pipe(
                Effect.provideService(ChildProcessSpawner, spawner),
                Effect.provideService(FSUtil.Service, fsUtil),
                Effect.provideService(Config.Service, config),
              )
              // The run's own session is always set at start; the fallback
              // mirrors the subagent parentID branding (SessionID.make).
              const askSessionID = input.permissionSessionID ?? SessionID.make(active.run.session_id!)
              const denied = (error: PermissionV1.Error) =>
                new InvalidError({
                  path: active.run.workflow,
                  message: `ctx.shell permission denied for command: ${command} (${error.message})`,
                })
              if (scan.dirs.size > 0) {
                const directories = Array.from(scan.dirs)
                const globs = directories.map((dir) =>
                  process.platform === "win32" ? FSUtil.normalizePathPattern(path.join(dir, "*")) : path.join(dir, "*"),
                )
                yield* permission
                  .ask({
                    permission: "external_directory",
                    patterns: globs,
                    always: globs,
                    sessionID: askSessionID,
                    ruleset: active.shellRuleset,
                    metadata: {
                      command,
                      cwd,
                      workflow: active.run.workflow,
                      source: "workflow.shell",
                      directories,
                      patterns: globs,
                    },
                  })
                  .pipe(Effect.mapError(denied))
              }
              if (scan.patterns.size > 0) {
                yield* permission
                  .ask({
                    permission: ShellID.ToolID,
                    patterns: Array.from(scan.patterns),
                    always: Array.from(scan.always),
                    sessionID: askSessionID,
                    ruleset: active.shellRuleset,
                    metadata: { command, cwd, workflow: active.run.workflow, source: "workflow.shell" },
                  })
                  .pipe(Effect.mapError(denied))
              }
            }
            // Finding 5: Process.run only kills the child when its `abort` signal
            // fires. Closing the run scope (cancel/pause/remove) INTERRUPTS this
            // Effect fiber, but `Effect.tryPromise` does NOT abort the underlying
            // promise — so without wiring the interrupt to an AbortController, a
            // no-timeout shell (e.g. `sleep 600`) was orphaned and kept running
            // after the run was cancelled/paused. ALWAYS create the controller and
            // fire it on BOTH (a) the optional wall-clock timeout AND (b) fiber
            // interruption (the scope-close path), so a cancel/pause actually
            // SIGTERMs/SIGKILLs the OS child. The controller is created OUTSIDE
            // tryPromise so `Effect.onInterrupt` can reach it.
            const controller = new AbortController()
            const result = yield* Effect.tryPromise(() => {
              const timer = opts?.timeout ? setTimeout(() => controller.abort(), opts.timeout) : undefined
              return Process.run([sh, ...Shell.args(sh, command, cwd)], {
                cwd,
                nothrow: true,
                abort: controller.signal,
              }).finally(() => {
                if (timer) clearTimeout(timer)
              })
            }).pipe(
              // Reap the OS child on fiber interruption: aborting the controller
              // makes Process.run SIGTERM the child (then SIGKILL after its grace),
              // so a scope-close cancel/pause no longer leaks the process.
              Effect.onInterrupt(() => Effect.sync(() => controller.abort())),
              Effect.orDie,
            )
            const output = Buffer.concat([result.stdout, result.stderr]).toString()
            return { output, exitCode: result.code }
          }),
        )
      }

      // Human-in-the-loop step (Tasks 12/13). Persists a pending question on the
      // run, records it as a `kind:"question"` journal node, and waits LIVE for an
      // answer (a Deferred resolved by the service `answer()` method) racing a
      // timeout (default 10 minutes). It deliberately does NOT consume an agent
      // dispatch, the budget, or the lifetime cap — a question is not an LLM step.
      const question: ContextApi["question"] = (questionInput) => {
        // Gate exactly like ctx.agent/ctx.shell: a fired signal or a landed
        // cancel/pause means the run is unwinding, so refuse to ask.
        if (runSignal?.aborted || active.cancelling || active.pausing || active.removed) throw new CancelledError()
        const phase = active.run.current_phase
        const node: AgentRun = {
          id: `${active.run.agents.length + 1}`,
          status: "running",
          started_at: Date.now(),
          phase,
          kind: "question",
          // The question text rides on `prompt` so it shares the journal-node
          // shape (and the resume key is built from it, like an agent prompt).
          prompt: questionInput.question,
        }
        active.run.agents.push(node)
        // Resume replay: a resumed run that was parked on this exact question
        // ([question, phase]) is served the SEEDED answer from the question journal
        // — no live ask, no pending_question. Mirrors the agent-journal replay:
        // mark the node completed + cached, record the answer, return it.
        const replayKey = questionJournalKey({ question: questionInput.question, phase })
        const seeded = active.questionJournal?.get(replayKey)
        if (seeded !== undefined) {
          node.status = "completed"
          node.completed_at = Date.now()
          node.answer = seeded
          node.cached = true
          persistInScope(active, bridge, db, events)
          return Promise.resolve({ answer: seeded })
        }
        // Live path: persist the open question (emits workflow.run.updated with
        // pending_question:true) and park on a Deferred + timeout race. The wait
        // runs through `dispatch` (forked into the run scope) so an external
        // pause()/cancel() that closes the run scope interrupts it — exactly like
        // a hung ctx.agent. `answer()` resolves the Deferred to wake it live.
        const timeout = questionInput.timeout ?? DEFAULT_QUESTION_TIMEOUT_MS
        const options = questionInput.options ? [...questionInput.options] : undefined
        return dispatch(
          Effect.gen(function* () {
            const deferred = yield* Deferred.make<{ answer: string }>()
            // Publish the open question and register the Deferred so answer() can
            // find + resolve it. Set BEFORE persist so a concurrent answer() that
            // observes the persisted pending_question also sees the live Deferred.
            active.pendingQuestion = { deferred, node }
            active.run.pending_question = { question: questionInput.question, options, asked_at: node.started_at }
            yield* persistRun(db, events, active)
            // Race the answer against the timeout. `timeoutOption` is interruptible,
            // so a run-scope close (external pause/cancel) unwinds this wait too.
            const result = yield* Deferred.await(deferred).pipe(Effect.timeoutOption(timeout))
            // Finding 4 (test seam): when the timeout won (`None`), fire the hook
            // HERE — `active.pendingQuestion` is still set, so a test's answer() can
            // take the live-answer branch and complete the node, deterministically
            // reproducing the timeout-vs-answer race the `.then` below must survive.
            // No-op in production (the hook is `Effect.void`).
            if (result._tag === "None") yield* questionTimeoutParkHook.pipe(Effect.ignore)
            return result
          }),
        ).then(
          (result) => {
            // Resolve (answer landed) or park (timeout). Either way the question is no
            // longer pending in-memory.
            active.pendingQuestion = undefined
            if (result._tag === "Some") {
              // Live answer. `answer()` is the authoritative writer (it completes the
              // node + clears pending_question + persists before resolving the
              // Deferred), so this branch only needs to hand the reply back to the
              // body. Idempotently close the node if it was somehow left open, so the
              // body never proceeds with a still-`running` question node.
              if (node.status === "running") {
                active.run.pending_question = undefined
                node.status = "completed"
                node.completed_at = Date.now()
                node.answer = result.value.answer
                persistInScope(active, bridge, db, events)
              }
              return result.value
            }
            // Timeout fired at the Effect level (`None`). Finding 4: a concurrent
            // answer() can land in the window between the timeout resolving and this
            // continuation running — it completes the question node + clears
            // pending_question + persists, then its Deferred.succeed is a no-op
            // (the timeout already completed the Deferred). If we parked
            // unconditionally here we would discard that recorded answer AND park as
            // paused, leaving the caller with a success snapshot while the run is
            // actually paused. So re-read the node: if a racing answer() already
            // closed it (status flipped to `completed`), hand that answer back to
            // the body instead of parking. Only park when the node is still open.
            if (node.status === "completed") {
              return { answer: node.answer! }
            }
            // PARK the run as `paused` via the existing pause machinery. Keep
            // `pending_question` AND the open question node intact (do NOT complete
            // the node) so a later answer() can resume. Setting `pausing` makes the
            // body's matchCauseEffect map this unwind to `paused`, racing pause()'s
            // own finish idempotently. Throwing CancelledError unwinds the body the
            // same way an interrupt-driven pause does.
            active.pausing = true
            throw new CancelledError()
          },
          (error) => {
            // An external pause()/cancel() that closed the run scope rejects the
            // dispatched wait with CancelledError. Drop the dangling in-memory
            // pending-question reference (the run is unwinding to paused/cancelled via
            // abortRun's own finish) and let the rejection propagate so the body
            // unwinds consistently with the rest of the engine.
            active.pendingQuestion = undefined
            throw error
          },
        )
      }

      // Build the run context for the top-level body OR a depth-1 nested workflow.
      // Captured here so `ctx.workflow` (below) can re-enter it with a bumped
      // `depth` and a `logPrefix`, sharing the SAME `active` — and thus the same
      // concurrency semaphore, budget, abort scope, and agent-lifetime cap.
      const buildContext = (ctxInput: { depth: number; logPrefix?: string; phases?: readonly Phase[] }): ContextApi =>
        createContext({
          active,
          agent,
          shell,
          question,
          workflow: (name, childArgs) => runNested(ctxInput.depth, name, childArgs),
          logPrefix: ctxInput.logPrefix,
          // Task 15: each context carries ITS OWN module's declared phases so
          // setPhase resolves the per-phase default model (and undeclared warning)
          // against the right list — the top-level run's phases, or a nested
          // child's own phases.
          phases: ctxInput.phases,
          persist: () => void persistInScope(active, bridge, db, events),
          signal: () => runSignal,
          dispatch,
        })

      // Depth-1 nesting: run another DISCOVERED workflow inline under the SAME run
      // (no second run row). It shares this run's `active`, so the concurrency
      // semaphore, budget, abort scope, and agent-lifetime cap all carry over
      // automatically — the child's `ctx.agent` dispatches funnel through the same
      // `agent` closure and count against the same gates. The parent run was
      // already approved (its own start went through the permission gate), so the
      // child loads with NO additional permission ask. A nested call (the child
      // itself calling ctx.workflow) is refused: nesting is limited to depth 1.
      //
      // A hoisted `function` declaration (not a `const` arrow) so `buildContext`
      // above can reference it without a temporal-dead-zone smell, even though
      // the reference is only invoked lazily once `ctx.workflow` is called.
      async function runNested(parentDepth: number, name: string, childArgs?: Record<string, unknown>) {
        if (parentDepth >= 1) {
          throw new InvalidError({
            path: active.run.workflow,
            message: "ctx.workflow nesting is limited to depth 1",
          })
        }
        // Load the named workflow via the existing discovery + loadModule path
        // (discoverWorkflows reads InstanceState, so run it through `dispatch`).
        // No permission ask: the parent run is already approved.
        const discovered = await dispatch(discoverWorkflows())
        const target = discovered.find((item) => item.name === name)
        if (!target) {
          throw new InvalidError({ path: active.run.workflow, message: `Workflow not found: ${name}` })
        }
        // Static meta gate, same as start()'s name branch: a nested child module
        // is validated AST-only BEFORE loadModule imports (and thereby executes)
        // it, so computed meta cannot slip in through the ctx.workflow seam
        // either. A read failure or non-literal meta throws a clean InvalidError
        // naming the child's file. (Same accepted TOCTOU between the gate read
        // and loadModule's own read as in start() — defense-in-depth, not a
        // security boundary.)
        const childSource =
          target.source !== undefined
            ? target.source
            : await fs.readFile(target.path, "utf8").then(
                (text) => text,
                (error) => {
                  throw new InvalidError({ path: target.path, message: errorText(error) })
                },
              )
        const childGate = MetaReader.read(childSource, target.path)
        if (childGate.valid === false) throw new InvalidError({ path: target.path, message: childGate.error })
        const childModule = await loadModule(target.path, target.source)
        const coerced = coerceArgs(childArgs, childModule.meta.arguments, target.path)
        if (coerced instanceof InvalidError) throw coerced
        // Child context shares `active`; depth+1 closes the nesting at 1 and the
        // logPrefix attributes the child's logs/phases without a second run row.
        const childCtx = buildContext({
          depth: parentDepth + 1,
          logPrefix: `${name}: `,
          phases: childModule.meta.phases,
        })
        // The child writes its (prefixed) phase into the SHARED
        // `active.run.current_phase` and its per-phase default model into the SHARED
        // `active.currentPhaseModel`. Snapshot BOTH parent values and restore them
        // after the child returns (resolve OR throw) so a parent log/agent dispatched
        // after the nested call is attributed to the parent's phase AND resolves the
        // parent's phase-default model, not the child's leftover ones.
        const parentPhase = active.run.current_phase
        const parentPhaseModel = active.currentPhaseModel
        try {
          return await childModule.run(coerced ?? {}, childCtx)
        } finally {
          active.run.current_phase = parentPhase
          active.currentPhaseModel = parentPhaseModel
        }
      }

      // Fund 5 (TOCTOU): a cancel/remove can land during the startup window —
      // after the run was registered but before the body fiber exists. In that
      // window abortRun set `cancelling`/closed the run scope and finish() already
      // moved the row to `cancelled`. Forking the body anyway would run the whole
      // workflow (burning tokens) under a row that already reports `cancelled`.
      // Re-check here and skip the fork entirely if a cancel has landed: the run
      // stays cancelled and the body never runs.
      if (active.cancelling || active.removed || active.run.status !== "running") {
        yield* Deferred.succeed(active.done, snapshot(active)).pipe(Effect.ignore)
        return snapshot(active)
      }

      active.fiber = yield* Effect.promise((signal) => {
        runSignal = signal
        return module.run(args ?? {}, buildContext({ depth: 0, phases: module.meta.phases }))
      }).pipe(
        Effect.matchCauseEffect({
          onSuccess: (result) => finish(id, "completed", { result }),
          onFailure: (cause) =>
            // A workflow module throwing CancelledError surfaces as a failure or
            // a defect depending on the path; squash returns the representative
            // error either way, so `isCancelled(squash)` catches both. A pausing
            // run interrupts the body the SAME way a cancel does, so it would map
            // to `cancelled` here — check `pausing` FIRST so a pause finishes as
            // the non-terminal `paused` (the journal is then kept for resume),
            // racing pause()'s own `finish(id, "paused")` idempotently.
            finish(
              id,
              active.pausing
                ? "paused"
                : active.cancelling ||
                    active.removed ||
                    Cause.hasInterruptsOnly(cause) ||
                    isCancelled(Cause.squash(cause))
                  ? "cancelled"
                  : "failed",
              active.pausing ? undefined : { error: errorText(Cause.squash(cause)) },
            ),
        }),
        Effect.asVoid,
        // OTel: wrap the whole run body in a `workflow.run` span so HTTP/CI/server
        // operators get observability for a run (the engine had ZERO spans before;
        // only the generic Tool.execute span wrapped a subagent's tool calls). The
        // span is purely observational — it sits AFTER matchCauseEffect/asVoid so it
        // never alters the run's success/cancel/fail mapping. Attribute style mirrors
        // the repo convention (dotted lowercase keys, e.g. tool.name/session.id).
        Effect.withSpan("workflow.run", {
          attributes: { "workflow.run_id": id, "workflow.name": active.run.workflow },
        }),
        // Fork lazily (no `startImmediately`) so this returns the fiber handle
        // immediately. With `startImmediately` the runtime drives the run body
        // synchronously into the first agent step, blocking `start` and leaving
        // `active.fiber` unassigned (which would make cancel a no-op).
        Effect.forkIn(inst.scope),
      )
      return snapshot(active)
    })

    const wait: Interface["wait"] = Effect.fn("Workflow.wait")(function* (input) {
      const run = yield* get(input.id)
      if (!run) return { timedOut: false }
      // Terminal runs (completed/failed/cancelled/interrupted) resolve at once —
      // there is no fiber left to wait on, so never report a timeout for them.
      if (run.status !== "running") return { run, timedOut: false }

      const live = yield* SynchronizedRef.get((yield* InstanceState.get(state)).runs)
      const active = live.get(input.id)
      // DB still says `running` but no live fiber owns it: an orphan. Sweep it to
      // `interrupted` and report that honestly instead of a misleading timeout.
      // Pass the live registry keys so genuinely-running siblings are untouched.
      if (!active) {
        yield* sweepOrphans(db, new Set(live.keys()), yield* Clock.currentTimeMillis, yield* InstanceState.directory)
        return { run: yield* get(input.id), timedOut: false }
      }
      if (input.timeout === undefined) return { run: yield* Deferred.await(active.done), timedOut: false }
      if (input.timeout <= 0) return { run: snapshot(active), timedOut: true }

      const done = yield* Deferred.await(active.done).pipe(Effect.timeoutOption(input.timeout))
      if (done._tag === "Some") return { run: done.value, timedOut: false }
      return { run: snapshot(active), timedOut: true }
    })

    // Race-free cancel. The order matters and every step is idempotent.
    // (0) Set `cancelling` FIRST — unconditionally, even when there is no fiber
    //     yet (startup window, Fund 5): the gates in agent()/checkpoint() and the
    //     settlement guards all key off it, and start() re-checks it before
    //     forking the body, so a cancel that lands during startup still wins.
    // (1) Abort every tracked child agent session via PromptOps.cancel from a
    //     LIVE view of `active.sessions` (not a one-shot snapshot, Fund 16): this
    //     is what actually stops the in-flight agent (same path as TUI Esc / HTTP
    //     abort); the production runner then RESOLVES the prompt and the agent
    //     step is recognised as cancelled. Sessions registered during this window
    //     additionally self-abort in agent() because `cancelling` is already set.
    // (2) Close the run scope: this propagates Interrupt into EVERY agent/parallel/
    //     pipeline fiber forked into it (Fund 14) — including ones started but not
    //     yet session-registered (Fund 16) and ones that have no cancel vector
    //     (Fund 50, where the scope close is the only thing that stops them).
    // (3) Interrupt the run fiber so checkpoint() unwinds the body, then await it.
    //
    // `mode` selects which suspension flag the gates key off: "cancel" sets
    // `cancelling` (run will finish `cancelled`), "pause" sets `pausing` (run will
    // finish the non-terminal `paused`, journal kept). The mechanics are identical
    // — the only difference is the terminal status finish() assigns.
    const abortRun = Effect.fn("Workflow.abortRun")(function* (active: Active, mode: "cancel" | "pause" = "cancel") {
      if (mode === "pause") active.pausing = true
      else active.cancelling = true
      const cancelSession = active.cancelSession
      if (cancelSession) {
        yield* Effect.forEach([...active.sessions], (sessionID) => cancelSession(SessionID.make(sessionID)), {
          concurrency: "unbounded",
          discard: true,
        }).pipe(Effect.ignore)
      }
      // Closing the run scope interrupts all dispatched agent work; it is safe to
      // close even with no live fiber (startup window). Forked so a slow finalizer
      // cannot wedge cancel.
      const scope = (yield* InstanceState.get(state)).scope
      const closed = yield* Scope.close(active.runScope, Exit.void).pipe(Effect.ignore, Effect.forkIn(scope))
      const interrupted = active.fiber ? yield* Fiber.interrupt(active.fiber).pipe(Effect.forkIn(scope)) : undefined
      if (interrupted) yield* Fiber.await(interrupted).pipe(Effect.ignore)
      yield* Fiber.await(closed).pipe(Effect.ignore)
      if (active.fiber) yield* Fiber.await(active.fiber).pipe(Effect.ignore)
    })

    const cancel: Interface["cancel"] = Effect.fn("Workflow.cancel")(function* (id) {
      const active = (yield* SynchronizedRef.get((yield* InstanceState.get(state)).runs)).get(id)
      // N16: a run that is not in the live registry is NOT automatically "not
      // found" — every persisted run after a restart, and every terminal run
      // evicted by N1, lives only in the DB. Consult the (directory-scoped) DB
      // row, exactly like get()/remove() do, so cancel never confuses
      // "found-but-not-cancellable" with "absent". A found-but-non-live run is
      // already terminal/orphaned (no live fiber to interrupt), so it is returned
      // honestly as its persisted snapshot rather than rewritten — but it is
      // returned, NOT undefined. undefined is reserved for a genuinely unknown id
      // (which the HTTP handler in Task 3h maps to 404). The scoping mirrors get():
      // a foreign-directory row is invisible here and so reports undefined too. The
      // same lookup also rescues a cancel that LOSES the race against the run's own
      // natural completion (below): the body fiber's `finish(id, "completed")` can
      // persist the terminal row and N1-evict it between this registry read and our
      // own `finish` — leaving our `finish` to return undefined for a run that very
      // much exists and is terminal. Both paths resolve to the persisted snapshot.
      const persisted = Effect.fn("Workflow.cancel.persisted")(function* () {
        const directory = yield* InstanceState.directory
        const row = yield* db
          .select()
          .from(WorkflowRunTable)
          .where(and(eq(WorkflowRunTable.id, id), eq(WorkflowRunTable.directory, directory)))
          .get()
          .pipe(Effect.orDie)
        return row ? fromRow(row) : undefined
      })
      if (!active) {
        // No live fiber. A paused run lives only in the DB (finish evicted it):
        // cancelling it transitions the non-terminal `paused` row to the terminal
        // `cancelled` directly (Spec §5.3). Any other persisted status (already
        // terminal) is returned verbatim, and an unknown id stays undefined.
        const row = yield* persisted()
        if (row?.status === "paused") {
          const completed_at = yield* Clock.currentTimeMillis
          const directory = yield* InstanceState.directory
          yield* db
            .update(WorkflowRunTable)
            .set({ status: "cancelled", completed_at, time_updated: completed_at })
            .where(and(eq(WorkflowRunTable.id, id), eq(WorkflowRunTable.directory, directory)))
            .run()
            .pipe(Effect.orDie)
          return yield* persisted()
        }
        return row
      }
      if (active.run.status !== "running") return snapshot(active)
      yield* abortRun(active)
      // Lost-race fallback: `finish` returns undefined only when the run was already
      // evicted (the body fiber completed and ran finish()'s N1 eviction first). The
      // run is terminal and gone from the registry — return its persisted snapshot
      // showing the TRUE terminal status (completed, NOT rewritten to cancelled),
      // never undefined. remove() already tolerates the same idempotent `finish`
      // here via `Effect.ignore`; cancel must additionally surface the snapshot.
      const finished = yield* finish(id, "cancelled")
      return finished ?? (yield* persisted())
    })

    const pause: Interface["pause"] = Effect.fn("Workflow.pause")(function* (id) {
      const active = (yield* SynchronizedRef.get((yield* InstanceState.get(state)).runs)).get(id)
      // Mirror cancel's directory-scoped DB fallback: a run not in the live
      // registry is consulted in the DB (after a restart / N1 eviction), so pause
      // never confuses "found-but-not-live" with "absent". undefined ⇒ genuinely
      // unknown id (HTTP → 404).
      const persisted = Effect.fn("Workflow.pause.persisted")(function* () {
        const directory = yield* InstanceState.directory
        const row = yield* db
          .select()
          .from(WorkflowRunTable)
          .where(and(eq(WorkflowRunTable.id, id), eq(WorkflowRunTable.directory, directory)))
          .get()
          .pipe(Effect.orDie)
        return row ? fromRow(row) : undefined
      })
      if (!active) return yield* persisted()
      // Only a genuinely running run can be paused; an already-terminal/paused run
      // is returned as-is (idempotent).
      if (active.run.status !== "running") return snapshot(active)
      yield* abortRun(active, "pause")
      // finish maps to `paused` (the body's interrupt-driven finish also keys off
      // `pausing`; both are idempotent). On the lost race against natural
      // completion `finish` returns undefined — surface the persisted snapshot,
      // whose TRUE status (completed) is reported, never rewritten.
      const finished = yield* finish(id, "paused")
      return finished ?? (yield* persisted())
    })

    // Item 15: skip ONE in-flight agent step of a LIVE run. Only live runs are
    // skippable (a persisted/terminal run has no step to resolve); the skip
    // request is recorded BEFORE the node's session is aborted (the Fund-16
    // request-flag-first ordering cancel uses), so the abort settlement in
    // agent() reliably reads it even when the abort lands instantly.
    const skipAgent: Interface["skipAgent"] = Effect.fn("Workflow.skipAgent")(function* (input) {
      const active = (yield* SynchronizedRef.get((yield* InstanceState.get(state)).runs)).get(input.id)
      if (!active) {
        // Distinguish 404 (unknown to this workspace) from 409 (known but not
        // live) via the directory-scoped row, mirroring cancel/pause.
        const directory = yield* InstanceState.directory
        const row = yield* db
          .select()
          .from(WorkflowRunTable)
          .where(and(eq(WorkflowRunTable.id, input.id), eq(WorkflowRunTable.directory, directory)))
          .get()
          .pipe(Effect.orDie)
        if (!row) return undefined
        return yield* new InvalidError({
          path: row.workflow,
          message: `Workflow run is not live: ${input.id} (${row.status})`,
        })
      }
      const node = active.run.agents.find((agent) => agent.id === input.agentId)
      if (!node) {
        return yield* new InvalidError({
          path: active.run.workflow,
          message: `Workflow agent run not found: ${input.agentId}`,
        })
      }
      // A question step is answered, never skipped — skipping it would strand
      // the body's ctx.question await without an answer.
      if (node.kind === "question") {
        return yield* new InvalidError({
          path: active.run.workflow,
          message: `Workflow agent run is a question; answer it instead of skipping: ${input.agentId}`,
        })
      }
      if (node.status !== "running") {
        return yield* new InvalidError({
          path: active.run.workflow,
          message: `Workflow agent run is not running: ${input.agentId} (${node.status})`,
        })
      }
      // Request flag FIRST (race window — see Fund 16), THEN abort the step's
      // session so the in-flight prompt resolves abort-marked and settles as
      // `skipped`. A node without a session yet is caught by the pre-prompt
      // check in agent() instead.
      active.skipRequests.add(node.id)
      if (node.session_id && active.cancelSession) {
        yield* active.cancelSession(SessionID.make(node.session_id)).pipe(Effect.ignore)
      }
      return snapshot(active)
    })

    const answer: Interface["answer"] = Effect.fn("Workflow.answer")(function* (input) {
      const id = input.id
      const active = (yield* SynchronizedRef.get((yield* InstanceState.get(state)).runs)).get(id)
      // LIVE run waiting in ctx.question: this is the authoritative writer. Complete
      // the question node + clear the persisted pending_question + persist, THEN
      // resolve the Deferred so the parked ctx.question wakes and hands { answer }
      // to the body. The returned snapshot already reflects the cleared question.
      //
      // Finding 10: refuse the live branch when the run is ALREADY unwinding to
      // paused/cancelled/removed (`pausing`/`cancelling`/`removed` set). An in-flight
      // pause() sets `active.pausing` synchronously and only LATER clears
      // `pendingQuestion` (via the scope-close → question reject). In that window the
      // live branch would otherwise clear+persist `pending_question` on a run that
      // then finishes `paused`, stranding an un-resumable paused row (no
      // pending_question). Mirrors the gate used by agent()/shell()/question(): a run
      // that is suspending does not have its open question consumed mid-abort. The
      // caller gets `undefined` (HTTP → 409) so it does not believe the answer stuck;
      // once the run settles `paused`, a subsequent answer() resumes it normally.
      if (
        active &&
        active.run.status === "running" &&
        active.pendingQuestion &&
        !active.pausing &&
        !active.cancelling &&
        !active.removed
      ) {
        const { deferred, node } = active.pendingQuestion
        active.pendingQuestion = undefined
        active.run.pending_question = undefined
        node.status = "completed"
        node.completed_at = yield* Clock.currentTimeMillis
        node.answer = input.answer
        yield* persistRun(db, events, active)
        yield* Deferred.succeed(deferred, { answer: input.answer }).pipe(Effect.ignore)
        return snapshot(active)
      }
      // No live open question. Consult the (directory-scoped) DB row: a `paused` run
      // with a persisted `pending_question` is resumed — start a NEW run keyed off
      // the source, seeding the answer into the question journal so the replayed
      // ctx.question returns it instead of asking again. Any other state (no pending
      // question, terminal, unknown id, foreign directory) ⇒ undefined.
      const directory = yield* InstanceState.directory
      const row = yield* db
        .select()
        .from(WorkflowRunTable)
        .where(and(eq(WorkflowRunTable.id, id), eq(WorkflowRunTable.directory, directory)))
        .get()
        .pipe(Effect.orDie)
      if (!row || row.status !== "paused" || !row.pending_question) return undefined
      // Capture the question text BEFORE consuming the row (the seed key) so the
      // claim's clearing of pending_question cannot lose it.
      const question = row.pending_question.question
      // Finding 1 (consume-once): atomically CLAIM the source row before starting
      // the resume so a repeated/concurrent answer() cannot spawn a SECOND resume run
      // (which would re-replay the journal and burn budget twice). A single
      // conditional UPDATE clears `pending_question` only while the row is still
      // `paused` with an open question; `.returning()` reports whether THIS call won
      // the claim. A losing second answer() gets 0 rows back → undefined, mirroring
      // cancel()'s consume-once on a paused row. Status stays `paused` so the resume
      // start() below still passes its paused/interrupted source-status guard, and
      // the journal replay reads `agents` (the question node), not this column.
      const now = yield* Clock.currentTimeMillis
      const claimed = yield* db
        .update(WorkflowRunTable)
        .set({ pending_question: null, time_updated: now })
        .where(
          and(
            eq(WorkflowRunTable.id, id),
            eq(WorkflowRunTable.directory, directory),
            eq(WorkflowRunTable.status, "paused"),
            isNotNull(WorkflowRunTable.pending_question),
          ),
        )
        .returning({ id: WorkflowRunTable.id })
        .all()
        .pipe(Effect.orDie)
      if (claimed.length === 0) return undefined
      // Resume: re-run the SAME workflow, replaying the agent journal AND serving
      // the seeded answer to the question node. The caller's execution options
      // (prompt-ops vector, permissionSessionID, caller, budget) are forwarded
      // UNCHANGED so a workflow that asks a question and then dispatches more
      // `ctx.agent` steps can run those steps live on the resumed run — without
      // them the post-question agent step would fail ("requires prompt operations").
      //
      // Finding 9: an INLINE-source run persists its module body on
      // definition.source and its NAME is never discoverable. Thread the persisted
      // source (and `temporary`) back so start() takes the inline-source LOAD path
      // and re-runs the SAME module — otherwise the named-discovery branch would
      // fail NotFound (or worse, load a foreign same-named workflow). Pass `name`
      // ONLY when there is no inline source (start()'s inline branch requires
      // `name === undefined`).
      const inlineSource = row.definition?.source
      return yield* start({
        name: inlineSource !== undefined ? undefined : row.workflow,
        source: inlineSource,
        temporary: row.definition?.temporary,
        args: row.args ?? undefined,
        resume_of: id,
        questionAnswers: { [question]: input.answer },
        prompt: input.prompt,
        permissionSessionID: input.permissionSessionID,
        caller: input.caller,
        budget: input.budget,
      })
    })

    const save: Interface["save"] = Effect.fn("Workflow.save")(function* (input) {
      // Sanitize the name to a single safe path segment BEFORE it becomes a path:
      // a `/`/`..` segment could escape the workflows dir, and a glob metacharacter
      // would later distort discovery/permission matching. Same shape the create
      // tool writes, so a saved file is discoverable/startable identically.
      if (!SAVE_NAME_PATTERN.test(input.name))
        return yield* Effect.fail(
          new InvalidError({
            path: input.name,
            message: "Workflow names may only contain letters, numbers, underscores, and dashes",
          }),
        )
      const ctx = yield* InstanceState.context
      const filepath = saveTargetPath(ctx, input.scope ?? "project", input.name)
      // Validate the source STATICALLY via the meta-reader (AST-only meta
      // extraction) BEFORE any write — identical to the create tool's gate. This
      // never imports/executes the module, so saving a run's source can never run
      // attacker-authored top-level code. A bad meta is a precise InvalidError.
      const validated = MetaReader.read(input.source, filepath)
      if (validated.valid === false)
        return yield* Effect.fail(new InvalidError({ path: filepath, message: validated.error }))
      // NEVER overwrite: a collision is a hard SaveConflictError (mirrors the create
      // tool's "Workflow already exists"), so a re-save can't clobber a hand-edited
      // file. The existence check + write are not atomic, but a save() is a
      // deliberate single-user action, so a TOCTOU race here is not a real concern.
      const exists = yield* Effect.promise(() =>
        fs
          .access(filepath)
          .then(() => true)
          .catch(() => false),
      )
      if (exists) return yield* Effect.fail(new SaveConflictError({ name: input.name, path: filepath }))
      yield* Effect.promise(async () => {
        await fs.mkdir(path.dirname(filepath), { recursive: true })
        await fs.writeFile(filepath, input.source)
      })
      return { path: filepath }
    })

    // Item 27: transcript export. Writes the run snapshot + one JSONL per agent
    // node under `<data>/workflow/<runId>/transcripts/` (the same per-run data
    // dir Item 18 uses for the persisted script.ts), so a human (or a manual
    // continuation script) can read the whole run off disk. All data already
    // exists in the DB row + the session store; this only materializes it.
    // The JSONL line shape ({ info, parts } per message / { node } fallback) is
    // a hand/debug format, deliberately NOT a schema-backed API contract.
    const exportRun: Interface["export"] = Effect.fn("Workflow.export")(function* (id) {
      // Directory-scoped exactly like get(): a run from another workspace (or
      // an unknown id) yields undefined → the HTTP handler maps it to 404.
      const run = yield* get(id)
      if (!run) return undefined
      const dir = path.join(Global.Path.data, "workflow", id, "transcripts")
      yield* Effect.promise(() => fs.mkdir(dir, { recursive: true }))
      const files: string[] = []
      const write = (name: string, content: string) =>
        Effect.promise(() => fs.writeFile(path.join(dir, name), content)).pipe(
          Effect.tap(() => Effect.sync(() => files.push(name))),
        )
      // (a) run.json: the full run snapshot (a still-running run exports its
      // current state). Re-export overwrites deterministically (same names).
      yield* write("run.json", JSON.stringify(run, null, 2))
      // (b) one <agent-id>.jsonl per node. Agent ids are engine-generated
      // counters ("1", "2", …) but are encodeURIComponent-ed anyway so a node
      // id can never traverse the directory. A node with a readable session
      // exports one line per message; a session-less or unreadable node
      // (replayed/cached, question, deleted session) exports a single fallback
      // line carrying the journal node — the export is always COMPLETE across
      // all nodes, never holey.
      for (const node of run.agents) {
        const name = `${encodeURIComponent(node.id)}.jsonl`
        const msgs = node.session_id
          ? yield* sessions
              .messages({ sessionID: SessionID.make(node.session_id) })
              .pipe(Effect.catchCause(() => Effect.succeed([] as SessionV1.WithParts[])))
          : []
        const lines =
          msgs.length > 0 ? msgs.map((m) => JSON.stringify({ info: m.info, parts: m.parts })) : [JSON.stringify({ node })]
        yield* write(name, lines.join("\n") + "\n")
      }
      return { path: dir, files }
    })

    const remove: Interface["remove"] = Effect.fn("Workflow.remove")(function* (id) {
      const inst = yield* InstanceState.get(state)
      const active = (yield* SynchronizedRef.get(inst.runs)).get(id)
      // A registered run is cancelled first (abort agent sessions + close the run
      // scope + interrupt the fiber) so delete cannot block on in-flight work and
      // no agent keeps running.
      if (active) {
        // Fund 3: set the tombstone BEFORE the delete. abortRun closes the run
        // scope, which interrupts dispatched agent fibers; their settlement
        // writes are forked into that same scope and may run AFTER the delete.
        // `persistRun` checks `removed` at execution time and NO-OPs, so a late
        // write can never re-INSERT (resurrect) the row.
        active.removed = true
        yield* abortRun(active)
        yield* finish(id, "cancelled").pipe(Effect.ignore)
      }
      yield* SynchronizedRef.update(inst.runs, (runs) => {
        const next = new Map(runs)
        next.delete(id)
        return next
      })
      // Scope both the existence probe and the delete to the calling workspace
      // (Fund 6): `DELETE …?directory=B` must NEVER delete a row owned by A and
      // report success. The `id` predicate alone would delete across directories
      // because the DB is global; adding the directory equality makes the delete
      // a no-op for a foreign row, and `row` (the scoped probe) stays undefined so
      // a cross-directory remove honestly reports `false`.
      const directory = yield* InstanceState.directory
      const scope = and(eq(WorkflowRunTable.id, id), eq(WorkflowRunTable.directory, directory))
      const row = yield* db.select().from(WorkflowRunTable).where(scope).get().pipe(Effect.orDie)
      yield* db.delete(WorkflowRunTable).where(scope).run().pipe(Effect.orDie)
      return !!row || !!active
    })

    const sweep: Interface["sweep"] = Effect.fn("Workflow.sweep")(function* () {
      const live = yield* SynchronizedRef.get((yield* InstanceState.get(state)).runs)
      yield* sweepOrphans(db, new Set(live.keys()), yield* Clock.currentTimeMillis, yield* InstanceState.directory)
    })

    return Service.of({
      list,
      read,
      runs,
      get,
      start,
      wait,
      cancel,
      pause,
      skipAgent,
      answer,
      save,
      export: exportRun,
      remove,
      sweep,
    })
  }),
)

export const defaultLayer = layer.pipe(
  Layer.provide(Database.defaultLayer),
  Layer.provide(Session.defaultLayer),
  Layer.provide(Agent.defaultLayer),
  Layer.provide(Provider.defaultLayer),
  Layer.provide(Config.defaultLayer),
  Layer.provide(EventV2Bridge.defaultLayer),
  // Item 23 (Stufe 1): Permission gates ctx.shell; FSUtil + the spawner feed
  // the bash tool's scanCommand the gate reuses.
  Layer.provide(Permission.defaultLayer),
  Layer.provide(FSUtil.defaultLayer),
  Layer.provide(CrossSpawnSpawner.defaultLayer),
)

export const node = LayerNode.make(layer, [
  Database.node,
  Session.node,
  Agent.node,
  Provider.node,
  Config.node,
  EventV2Bridge.node,
  // Item 23 (Stufe 1): see defaultLayer.
  Permission.node,
  FSUtil.node,
  CrossSpawnSpawner.node,
])

export * as Workflow from "./workflow"
