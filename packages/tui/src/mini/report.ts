/**
 * `bolt run --cost-report`: per-run cost accounting. Accumulates the same
 * step-finish usage the budget guard consumes, then reports tokens, cache
 * hits, dollars, and wall time. Human output goes to stderr so stdout stays
 * clean for the answer; `--format json` consumers get a `cost_report` event
 * on the existing envelope instead.
 */
import type { StepUsage } from "./budget"

export interface State {
  cost: number
  steps: number
  input: number
  output: number
  reasoning: number
  read: number
  write: number
}

export const empty: State = { cost: 0, steps: 0, input: 0, output: 0, reasoning: 0, read: 0, write: 0 }

/** Accumulate one step-finish part into the running usage. */
export function add(state: State, part: StepUsage): State {
  return {
    cost: state.cost + part.cost,
    steps: state.steps + 1,
    input: state.input + part.tokens.input,
    output: state.output + part.tokens.output,
    reasoning: state.reasoning + part.tokens.reasoning,
    read: state.read + part.tokens.cache.read,
    write: state.write + part.tokens.cache.write,
  }
}

/** Share of prompt-side tokens served from cache, undefined when nothing was prompted. */
export function ratio(state: State) {
  const prompted = state.input + state.read
  if (prompted === 0) return undefined
  return state.read / prompted
}

/** Structured report for the --format json envelope. */
export function json(state: State, wall: number) {
  return {
    cost: state.cost,
    wall,
    steps: state.steps,
    tokens: {
      total: state.input + state.output + state.reasoning + state.read + state.write,
      input: state.input,
      output: state.output,
      reasoning: state.reasoning,
      cache: { read: state.read, write: state.write },
    },
    cacheRatio: ratio(state),
  }
}

/** Compact wall-time rendering. */
export function clock(ms: number) {
  if (ms < 1000) return `${Math.max(0, Math.round(ms))}ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`
  return `${Math.floor(ms / 60_000)}m${Math.round((ms % 60_000) / 1000)}s`
}

/** Human report printed to stderr. `wall` is elapsed milliseconds. */
export function render(state: State, wall: number): string {
  const total = state.input + state.output + state.reasoning + state.read + state.write
  const share = ratio(state)
  const cache =
    state.read === 0 && state.write === 0
      ? "cache: no cached tokens"
      : `cache: ${state.read.toLocaleString("en-US")} read, ${state.write.toLocaleString("en-US")} written` +
        (share === undefined ? "" : ` (${Math.round(share * 100)}% of prompt tokens from cache)`)
  return [
    `cost report: $${state.cost.toFixed(4)} · ${clock(wall)} wall · ${state.steps} step${state.steps === 1 ? "" : "s"}`,
    `tokens: ${total.toLocaleString("en-US")} total (input ${state.input.toLocaleString("en-US")}, output ${state.output.toLocaleString("en-US")}, reasoning ${state.reasoning.toLocaleString("en-US")})`,
    cache,
  ].join("\n")
}

export * as Report from "./report"
