// Workflow engine error classes, split out of workflow.ts so the engine, the
// HTTP handlers, and the tests can share the exact same TaggedError tags without
// pulling in the full engine module. The public `Workflow.<Error>` surface is
// preserved by re-exporting every class from the workflow.ts barrel. The tag
// strings ("WorkflowNotFoundError", "WorkflowSaveConflictError", …) are matched
// on by HTTP handlers (e.g. SaveConflictError -> 409) and tests, so they MUST NOT
// change.
import { Schema } from "effect"

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
