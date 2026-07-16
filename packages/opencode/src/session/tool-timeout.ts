export * as ToolTimeout from "./tool-timeout"

import { Schema, Duration } from "effect"
import { Effect } from "effect"
import { Agent } from "@/agent/agent"
import { Config } from "@/config/config"

/**
 * Raised when a tool call exceeds its configured execution deadline. The runner
 * catches this to synthesize a tool-result so the agent loop can continue
 * instead of wedging on a `status="running"` part that never resolves.
 *
 * See https://github.com/anomalyco/opencode/issues/20096 — the documented LLM
 * `timeout` covers provider requests but opencode had no equivalent for the
 * tool-side execution path, so a hung tool (e.g. an MCP server, a bash command
 * that spawns a daemon, a detached browser session) blocked the session
 * indefinitely.
 */
export class ToolTimeoutError extends Schema.TaggedErrorClass<ToolTimeoutError>()("ToolTimeoutError", {
  tool: Schema.String,
  timeoutMs: Schema.Number,
}) {
  override get message() {
    return `Tool "${this.tool}" timed out after ${this.timeoutMs}ms`
  }
}

// Combine the upstream caller's AbortSignal (user-initiated Esc interrupt) with
// our session-level timeout controller so a single `ctx.abort` surfaces both.
// `AbortSignal.any` is Node 20+/Bun-native; when both inputs are missing we
// return undefined so we don't replace nothing with nothing.
function composeSignals(user?: AbortSignal, ours?: AbortSignal): AbortSignal | undefined {
  const signals = [user, ours].filter((s): s is AbortSignal => Boolean(s))
  if (signals.length === 0) return undefined
  if (signals.length === 1) return signals[0]
  return AbortSignal.any(signals)
}

/**
 * Wrap a tool execution with a timeout controller. Creates an AbortController
 * that fires `ToolTimeoutError` after `timeoutMs`, composes it with the
 * caller's abort signal, and guarantees cleanup (clearTimeout) via finally.
 *
 * Returns `{ signal, ctx }` with the merged abort signal so the tool can
 * pass it into its context construction. The caller is responsible for
 * catching `ToolTimeoutError` and synthesizing the tool-result.
 */
/**
 * Create a timeout controller for a single tool execution. Returns:
 * - `signal`: merged AbortSignal (caller's signal + our timeout timer)
 * - `dispose`: cleanup function — must be called in a finally block
 *
 * The caller passes `signal` into their tool context construction and calls
 * `dispose()` to clear the timer after execution completes or fails.
 */
export function createTimeoutController(opts: { tool: string; timeoutMs: number; userSignal?: AbortSignal }): {
  signal: AbortSignal | undefined
  dispose: () => void
} {
  const controller = new AbortController()
  const timer = setTimeout(
    () => controller.abort(new ToolTimeoutError({ tool: opts.tool, timeoutMs: opts.timeoutMs })),
    opts.timeoutMs,
  )
  const signal = composeSignals(opts.userSignal, controller.signal)
  return {
    signal,
    dispose: () => clearTimeout(timer),
  }
}

/**
 * Per-tool execution deadline in milliseconds. `0` disables the timeout for
 * this tool entirely (the agent's underlying `abort` signal still fires on
 * user-initiated interrupt via Esc).
 */
export const DEFAULT_TOOL_TIMEOUT_MS = 600_000

/**
 * Resolve the per-call execution timeout for the given (tool, agent) pair.
 *
 * Precedence (highest wins):
 *   1. Per-agent `agent.tool_timeout`
 *   2. `experimental.task_timeout` (only for the `task` tool)
 *   3. Global `experimental.tool_timeout`
 *   4. Hardcoded `DEFAULT_TOOL_TIMEOUT_MS` (10 min)
 *
 * Returns `0` when the effective config value is `0`, which the runner
 * interprets as "disable the timeout entirely".
 */
export const resolve = Effect.fnUntraced(function* (input: { tool: string; agent: Agent.Info }) {
  const service = yield* Config.Service
  const cfg = yield* service.get()
  const experimental = cfg.experimental
  const globalDefault = experimental?.tool_timeout ?? DEFAULT_TOOL_TIMEOUT_MS
  if (input.agent.tool_timeout !== undefined) return input.agent.tool_timeout
  if (input.tool === "task" && experimental?.task_timeout !== undefined) return experimental.task_timeout
  return globalDefault
})
