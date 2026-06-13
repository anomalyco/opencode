import { Schema } from "effect"
import { ConfigV1 } from "@opencode-ai/core/v1/config/config"
import { SessionID } from "./schema"

/**
 * Shared constants and typed errors for nested subagent spawning
 * (design-final.md §2). Depth is a purely derived value: the root ("CEO")
 * session is depth 1 and every task/subtask/workflow dispatch adds one level.
 * This is a plain module on purpose — NOT an Effect service — so the session
 * layer, tools and the workflow dispatcher can consume it without wiring.
 */

/** Default maximum nesting depth (root session = 1; levels 1..4 may spawn). */
export const DEFAULT_MAX_TASK_DEPTH = 5

/**
 * Config-free upper bound enforced as an invariant in `Session.createNext`:
 * no code path — including plugins or future dispatchers — can create a
 * session deeper than this. Also the clamp ceiling for `maxDepth`.
 */
export const HARD_MAX_DEPTH = 10

/**
 * In-memory lifetime cap on subagents started per session tree (keyed by root
 * session). A safety ceiling against runaway delegation within one process
 * run, not an accounting counter; resumes do not count, workflow dispatches
 * keep their own `DEFAULT_AGENT_LIMIT`.
 */
export const SUBAGENT_TREE_LIMIT = 200

/**
 * Fail-fast breadth cap on the number of subagents a SINGLE session may have
 * running concurrently as its direct children (design-final §10 variant (b),
 * Phase-2 Issue 1). Keyed by the SPAWNING session, NOT the tree root: a
 * tree-wide semaphore over foreground chains deadlocks (proven counterexample —
 * two parallel L2 foreground parents each hold a permit and wait on an L3 child
 * that can never get one). Counting per spawner keeps every level's budget
 * independent, so a foreground parent never competes with its own descendants.
 *
 * The cap is fail-fast: an over-cap spawn raises SubagentConcurrencyError
 * immediately instead of queuing/blocking, which is what guarantees the abort
 * cascade can never hang on a permit (no waiter exists to interrupt).
 *
 * Default 8 is deliberately conservative: it is well above the typical handful
 * of parallel delegations a single agent issues, while still bounding a runaway
 * fan-out at one level. The lifetime SUBAGENT_TREE_LIMIT and the depth limit
 * remain the tree-wide ceilings; this only bounds INSTANTANEOUS width per node.
 */
export const DEFAULT_SUBAGENT_CONCURRENCY = 8

/**
 * Iteration cap for the `Session.lineage` parent-chain walk. Legitimate chains
 * are at most HARD_MAX_DEPTH long; exceeding this means corrupt or cyclic
 * parent data and fails with SubagentLineageError instead of hanging.
 */
export const LINEAGE_ITERATION_CAP = 32

/**
 * Resolves the effective maximum nesting depth from config — the single source
 * of truth for `experimental.subagent_max_depth` (clamped to 1..HARD_MAX_DEPTH,
 * default DEFAULT_MAX_TASK_DEPTH). Semantics (design-final §2.5): `5` is the
 * target behavior, `2` reproduces the pre-nesting behavior (root spawns,
 * subagents do not) and `1` is the kill switch (even the root loses the task
 * tool). NEVER document `1` as the legacy behavior — that is an off-by-one.
 */
export function maxDepth(cfg: ConfigV1.Info): number {
  // The config key ships with the default-opening track; the cast keeps this
  // helper typed against ConfigV1.Info before and after the schema gains it.
  const raw = (cfg.experimental as { subagent_max_depth?: number } | undefined)?.subagent_max_depth
  if (typeof raw !== "number" || !Number.isFinite(raw)) return DEFAULT_MAX_TASK_DEPTH
  return Math.min(Math.max(Math.trunc(raw), 1), HARD_MAX_DEPTH)
}

/**
 * Appended to the task tool description on levels 2..max−1 so subagents know
 * their remaining delegation budget instead of discovering it by failed calls.
 */
export function depthHint(depth: number, max: number): string {
  return `You are a sub-agent at delegation depth ${depth} of ${max}. You may delegate to deeper sub-agents; prefer doing small tasks yourself.`
}

/**
 * Raised when a session at the maximum nesting depth attempts to spawn another
 * subagent (or, as the config-free hard cap in `Session.createNext`, when a
 * child would exceed HARD_MAX_DEPTH). Tests match on the tag; the message is
 * model-directed and pinned once in subagent-limits.test.ts.
 */
export class SubagentDepthError extends Schema.TaggedErrorClass<SubagentDepthError>()("SubagentDepthError", {
  message: Schema.String,
  depth: Schema.Finite,
  limit: Schema.Finite,
}) {}

export const depthError = (input: { depth: number; limit: number }) =>
  new SubagentDepthError({
    ...input,
    message: `Subagent nesting limit reached: this session is already at the maximum nesting depth (${input.depth} of ${input.limit}; the root session is depth 1). Do the remaining work yourself in this session and report the results in your final message instead of delegating.`,
  })

/**
 * Raised when a session tree has started its lifetime cap of subagents
 * (SUBAGENT_TREE_LIMIT, overridable via `__testHooks.treeLimit`).
 */
export class SubagentTreeLimitError extends Schema.TaggedErrorClass<SubagentTreeLimitError>()(
  "SubagentTreeLimitError",
  {
    message: Schema.String,
    started: Schema.Finite,
    limit: Schema.Finite,
  },
) {}

export const treeLimitError = (input: { started: number; limit: number }) =>
  new SubagentTreeLimitError({
    ...input,
    message: `Subagent limit reached: this session tree has already started ${input.started} of ${input.limit} subagents (the cap guards against runaway delegation). Finish the remaining work directly in this session.`,
  })

/**
 * Raised when a SINGLE session already has its fail-fast breadth cap of direct
 * child subagents running concurrently (DEFAULT_SUBAGENT_CONCURRENCY,
 * overridable via `__testHooks.concurrency`). Fail-fast by design (design-final
 * §10 variant (b)): the over-cap spawn is refused immediately, never queued, so
 * no waiter exists that an abort cascade could hang on. Tests match on the tag;
 * the message is model-directed and pinned once in subagent-limits.test.ts.
 */
export class SubagentConcurrencyError extends Schema.TaggedErrorClass<SubagentConcurrencyError>()(
  "SubagentConcurrencyError",
  {
    message: Schema.String,
    running: Schema.Finite,
    limit: Schema.Finite,
  },
) {}

export const concurrencyError = (input: { running: number; limit: number }) =>
  new SubagentConcurrencyError({
    ...input,
    message: `Subagent concurrency limit reached: this session already has ${input.running} of ${input.limit} subagents running at once (the cap bounds parallel fan-out). Wait for one to finish, or do the remaining work directly in this session, before delegating again.`,
  })

/**
 * Raised when `task_id` names an existing session that is NOT a direct child
 * of the caller — resuming ancestors or foreign sessions is refused instead of
 * silently adopted (closes the verified resume deadlock).
 */
export class SubagentResumeError extends Schema.TaggedErrorClass<SubagentResumeError>()("SubagentResumeError", {
  message: Schema.String,
  taskID: Schema.String,
}) {}

export const resumeError = (input: { taskID: string }) =>
  new SubagentResumeError({
    ...input,
    message: `Cannot resume task ${input.taskID}: it is not a subagent of this session. task_id can only resume tasks this session started itself.`,
  })

/**
 * Raised by the spawn gate when the shared turn-budget pool is exhausted —
 * running subagents may finish, new ones are refused (soft cap).
 */
export class SubagentBudgetError extends Schema.TaggedErrorClass<SubagentBudgetError>()("SubagentBudgetError", {
  message: Schema.String,
}) {}

export const budgetError = () =>
  new SubagentBudgetError({
    message:
      "Turn budget exhausted: cannot start another subagent. Finish the remaining work directly within this session.",
  })

/**
 * Raised when the parent-chain walk exceeds LINEAGE_ITERATION_CAP (corrupt or
 * cyclic session parents). Callers treat this like "depth ≥ limit": spawning
 * is refused and the task/workflow tools are filtered.
 */
export class SubagentLineageError extends Schema.TaggedErrorClass<SubagentLineageError>()("SubagentLineageError", {
  message: Schema.String,
  sessionID: SessionID,
}) {}

export const lineageError = (input: { sessionID: SessionID }) =>
  new SubagentLineageError({
    ...input,
    message:
      "Session ancestry could not be resolved (possible cycle in session parents); refusing to spawn subagents from this session.",
  })

/**
 * Test seam for the tree lifetime cap (mirrors `__testHooks.agentLimit` in
 * workflow.ts): when set, the task tool gates on this value instead of
 * SUBAGENT_TREE_LIMIT. Inert in production.
 */
export const __testHooks = {
  treeLimit: undefined as number | undefined,
  /**
   * Test seam for the per-session concurrency cap (Phase-2 Issue 1): when set,
   * the task tool gates on this value instead of DEFAULT_SUBAGENT_CONCURRENCY.
   * Inert in production.
   */
  concurrency: undefined as number | undefined,
}

export * as SubagentLimits from "./subagent-limits"
