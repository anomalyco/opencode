// Public input/option/context TYPES for the workflow engine, split out of
// workflow.ts. These are the start/wait/answer/save input shapes, the agent/tool
// option shapes, the parallel/pipeline aliases (owned by @opencode-ai/plugin),
// the `ContextApi` (engine-side `ctx` view), and the `Interface` service shape.
// Re-exported from the workflow.ts barrel so the public `Workflow.StartInput` /
// `Workflow.AgentInput` / `Workflow.ContextApi` / `Workflow.Interface` / … surface
// is unchanged.
import { Effect, Schema } from "effect"
import type { SessionPrompt } from "@/session/prompt"
import { SessionID } from "@/session/schema"
import { TurnBudget } from "@/session/turn-budget"
import { SessionV1 } from "@opencode-ai/core/v1/session"
import type {
  WorkflowContext,
  WorkflowParallelOptions,
  WorkflowPipelineFn,
  WorkflowPipelineOptions,
  WorkflowPipelineStage,
  WorkflowToolFn,
} from "@opencode-ai/plugin/workflow"
import type { Info, Run, RunID, Source } from "./schema"
import type { InvalidError, NotFoundError, SaveConflictError } from "./errors"

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

export type ToolInput = {
  timeout?: number
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
  readonly tool: WorkflowToolFn
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

// The Workflow service shape. Kept here with the other public types; the
// implementing `Service` class + engine `layer` live in engine.ts.
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
