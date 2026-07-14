export * as ToolTimeout from "./tool-timeout"

import { Schema } from "effect"
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
export class ToolTimeoutError extends Schema.TaggedErrorClass<ToolTimeoutError>()(
  "ToolTimeoutError",
  {
    tool: Schema.String,
    timeoutMs: Schema.Number,
  },
) {
  override get message() {
    return `Tool "${this.tool}" timed out after ${this.timeoutMs}ms`
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
export const resolve = Effect.fnUntraced(function* (input: {
  tool: string
  agent: Agent.Info
}) {
  const service = yield* Config.Service
  const cfg = yield* service.get()
  const experimental = cfg.experimental
  const globalDefault = experimental?.tool_timeout ?? DEFAULT_TOOL_TIMEOUT_MS
  if (input.agent.tool_timeout !== undefined) return input.agent.tool_timeout
  if (input.tool === "task" && experimental?.task_timeout !== undefined) return experimental.task_timeout
  return globalDefault
})
