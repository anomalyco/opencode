type WorkflowArgumentType = "string" | "number" | "boolean"

type WorkflowArgument = {
  type?: WorkflowArgumentType
  default?: unknown
  description?: string
}

type WorkflowArguments = Record<string, WorkflowArgument>

type WorkflowArgumentValue<T extends WorkflowArgument> = T["type"] extends "number"
  ? number
  : T["type"] extends "boolean"
    ? boolean
    : string

type WorkflowArgs<Args extends WorkflowArguments | undefined> = Args extends WorkflowArguments
  ? { readonly [Key in keyof Args]?: WorkflowArgumentValue<Args[Key]> }
  : Record<string, unknown>

export type WorkflowAgentInput = {
  prompt: string
  agent?: string
  model?: string
  /** Per-step model reasoning variant (e.g. "max"), threaded into the underlying prompt run. */
  variant?: string
  /**
   * Per-step tool scoping for this agent step. A map of tool/permission name to
   * whether it is enabled, with glob-able keys (e.g. `{ webfetch: false }` or
   * `{ "skill_*": true }`). Each entry becomes an allow/deny permission rule on
   * the child session, so the subagent only sees the tools you scope it to.
   */
  tools?: Record<string, boolean>
  /**
   * Skills to make available to this agent step. opencode loads skills at
   * runtime via the `skill` tool, so naming them here prepends a "Load these
   * skills before starting: …" directive to the prompt and enables the `skill`
   * tool for the step (merged with any `tools` scoping). The agent loads each
   * named skill before doing its work.
   */
  skills?: string[]
  /**
   * Files to attach to this agent step. Each path is resolved relative to the
   * run's workspace directory (absolute paths are used as-is) and must exist —
   * a missing file fails the step. Each attachment is appended after the prompt
   * as a file part, so the agent can read it directly.
   */
  files?: string[]
  schema?: unknown
  permissionSessionID?: string
  /**
   * Explicit progress group for THIS call. Pins the step to the named phase
   * regardless of where `ctx.setPhase` currently points — closing the race
   * window when setPhase and agent() run under parallel/pipeline concurrency.
   * A phase declared in `meta.phases` with a `model` activates that model as
   * this call's default (an explicit `model` still wins). The run's current
   * phase is NOT changed (no setPhase side effect).
   */
  phase?: string
  /** Display name for this step in run views (defaults to the agent name). */
  label?: string
  /**
   * Run this step's subagent in a FRESH `git worktree` instead of the run's
   * workspace, so parallel agents that mutate files do not conflict. The
   * worktree is created when the step dispatches and auto-removed when the run
   * finishes or is cancelled. Requires the workspace to be a git repository;
   * otherwise the step fails with a clear error.
   */
  isolation?: "worktree"
  /**
   * What a FAILING step resolves to. Default `"fail"`: the error propagates
   * (the run fails unless you catch it). `"null"`: the step resolves `null`
   * (its node stays `failed` with the error recorded) so the workflow body can
   * branch on the outcome. Budget/lifetime limits and aborts are NEVER
   * swallowed — those always throw regardless of this option.
   */
  onError?: "fail" | "null"
}

export type WorkflowAgentResult = {
  data: unknown
  text: string
}

export type WorkflowToolOptions = {
  timeout?: number
  onError?: "fail" | "null"
}

export type WorkflowToolResult = {
  output: string
  metadata?: Record<string, unknown>
}

export interface WorkflowToolFn {
  (name: string, args?: Record<string, unknown>, options?: WorkflowToolOptions & { onError: "null" }): Promise<WorkflowToolResult | null>
  (name: string, args?: Record<string, unknown>, options?: WorkflowToolOptions): Promise<WorkflowToolResult>
}
export type WorkflowParallelOptions = { concurrencyLimit?: number }
export type WorkflowPipelineOptions = { concurrencyLimit?: number }

/** A pipeline stage: receives the previous stage's output for this item plus the
 * original item, and returns the next value. The first stage's `prev` is the
 * item itself. Stages may change the type (`I → S1 → S2 …`). `index` is the
 * item's position in the original items array — the same value for every stage
 * an item flows through (a two-parameter stage simply ignores it). */
export type WorkflowPipelineStage<Prev, Item, Next> = (prev: Prev, item: Item, index: number) => Promise<Next>

/** Per-item pipeline. Each item flows through every stage SEQUENTIALLY (stage N+1
 * receives stage N's result for that item), while items run concurrently against
 * each other (no barrier between stages). Result is the last stage's output in
 * item order. A stage that throws does NOT fail the whole pipeline — it drops ONLY
 * that item to `null` at its position (skipping that item's remaining stages, and
 * logging the drop); other items keep running. Only a run abort stays fatal.
 * Filter the result before use, e.g. `.filter((x) => x !== null)`. Overloaded for
 * 1..4 stages so heterogeneous types flow through. */
export interface WorkflowPipelineFn {
  <I, A>(
    items: readonly I[],
    s1: WorkflowPipelineStage<I, I, A>,
    options?: WorkflowPipelineOptions,
  ): Promise<(A | null)[]>
  <I, A, B>(
    items: readonly I[],
    s1: WorkflowPipelineStage<I, I, A>,
    s2: WorkflowPipelineStage<A, I, B>,
    options?: WorkflowPipelineOptions,
  ): Promise<(B | null)[]>
  <I, A, B, C>(
    items: readonly I[],
    s1: WorkflowPipelineStage<I, I, A>,
    s2: WorkflowPipelineStage<A, I, B>,
    s3: WorkflowPipelineStage<B, I, C>,
    options?: WorkflowPipelineOptions,
  ): Promise<(C | null)[]>
  <I, A, B, C, D>(
    items: readonly I[],
    s1: WorkflowPipelineStage<I, I, A>,
    s2: WorkflowPipelineStage<A, I, B>,
    s3: WorkflowPipelineStage<B, I, C>,
    s4: WorkflowPipelineStage<C, I, D>,
    options?: WorkflowPipelineOptions,
  ): Promise<(D | null)[]>
}

export type WorkflowContext = {
  /**
   * Remaining run budget in USD. Reflects the live cost cap the run was started
   * with, decremented by each agent step's actual cost. `Infinity` when the run
   * was started without a budget (unlimited — the default). Read it to make a
   * workflow budget-aware; the engine additionally fails the next `agent()` call
   * with a budget error once this reaches zero.
   *
   * @deprecated USD-only view; prefer `ctx.budget.remaining()` (and
   * `tokensRemaining()` for the token cap).
   */
  readonly budgetRemaining: number
  /**
   * Budget in Claude-Code API shape. USD: `total` (null when unlimited),
   * `spent()` so far, `remaining()` (Infinity when unlimited). Tokens:
   * `tokensTotal`/`tokensSpent()`/`tokensRemaining()` — the same trio for the
   * independent output-token cap (`budget: { tokens }` at start).
   */
  readonly budget: {
    readonly total: number | null
    spent(): number
    remaining(): number
    readonly tokensTotal: number | null
    tokensSpent(): number
    tokensRemaining(): number
  }
  /**
   * Switch the run's current phase. When the named phase is declared in
   * `meta.phases` as a structured object with a `model`, that model becomes the
   * DEFAULT for subsequent `ctx.agent` calls that omit an explicit `model` (an
   * explicit per-call model still wins). Setting an UNDECLARED phase is allowed —
   * it clears any phase-default model and logs a warning, never an error.
   */
  setPhase(phase: string): void
  log(message: string): void
  /**
   * Run `tasks` concurrently and resolve to their results in task order. A thunk
   * that throws (or whose `agent()` errors) does NOT fail the whole batch — it
   * resolves to `null` at its position (the drop is logged); only a run abort
   * stays fatal. Filter the result before use, e.g. `.filter((x) => x !== null)`.
   */
  parallel<T>(tasks: readonly (() => Promise<T>)[], options?: WorkflowParallelOptions): Promise<(T | null)[]>
  pipeline: WorkflowPipelineFn
  /**
   * Resolves `null` when a human skips the step, or with `onError: "null"` when
   * the step fails. Guard the result before dereferencing (`if (!r) …`).
   */
  agent(input: WorkflowAgentInput): Promise<WorkflowAgentResult | null>
  /**
   * Call an available opencode tool directly from the workflow without dispatching
   * an agent step. Uses the same permission path as normal tool calls. With
   * `onError: "null"`, a failing tool call resolves `null` instead of failing the run.
   */
  tool: WorkflowToolFn
  /**
   * Deterministic non-LLM step: run a shell command in the run's workspace (or an
   * explicit `cwd`) and resolve to `{ output, exitCode }`. Unlike `agent()`, this
   * consumes NO LLM turn and does NOT touch the run's budget — `budget.spent()`
   * is unaffected. A non-zero exit is returned as `exitCode`, never thrown, so
   * inspect `exitCode` to branch on failure.
   */
  shell(command: string, opts?: { timeout?: number; cwd?: string }): Promise<{ output: string; exitCode: number }>
  /**
   * Run another DISCOVERED workflow inline under the SAME run (no separate run
   * row), sharing this run's concurrency, budget, abort scope, and agent-lifetime
   * cap. Returns the child's `run()` result. Nesting is limited to depth 1: a
   * workflow invoked via `ctx.workflow` cannot itself call `ctx.workflow`.
   */
  workflow(name: string, args?: Record<string, unknown>): Promise<unknown>
  /**
   * Ask a human a question and wait for the answer (human-in-the-loop). Persists
   * the question on the run and resolves to `{ answer }` once it is answered via
   * the workflow `answer` API, racing a timeout (default 10 minutes). If the
   * timeout elapses unanswered the run PARKS as `paused` with the question kept —
   * a later answer resumes the run and the body receives the reply (replayed from
   * the journal) without asking again. `options` is an optional list of suggested
   * answers surfaced to the human; the resolved `answer` is a free-form string.
   */
  question(input: { question: string; options?: readonly string[]; timeout?: number }): Promise<{ answer: string }>
}

/**
 * A workflow phase. Authors may list a phase as a plain string (the title) or as
 * a structured object. `model` is a per-phase DEFAULT model: a `ctx.agent` call
 * made while that phase is active and given no explicit `model` resolves to it
 * (an explicit per-call model still wins). `detail` is optional human copy.
 */
export type WorkflowPhase = string | { title: string; detail?: string; model?: string }

export type WorkflowDefinition<Args extends WorkflowArguments | undefined = WorkflowArguments | undefined> = {
  meta: {
    name: string
    description?: string
    whenToUse?: string
    phases?: readonly WorkflowPhase[]
    arguments?: Args
  }
  run(args: WorkflowArgs<Args>, ctx: WorkflowContext): Promise<unknown>
}

export function workflow<const Args extends WorkflowArguments | undefined = undefined>(input: {
  name: string
  description?: string
  whenToUse?: string
  phases?: readonly WorkflowPhase[]
  arguments?: Args
  run(args: WorkflowArgs<Args>, ctx: WorkflowContext): Promise<unknown>
}): WorkflowDefinition<Args> {
  return {
    meta: {
      name: input.name,
      description: input.description,
      whenToUse: input.whenToUse,
      phases: input.phases,
      arguments: input.arguments,
    },
    run: input.run,
  }
}
