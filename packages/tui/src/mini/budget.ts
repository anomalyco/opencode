export interface State {
  cost: number
  tokens: number
}

export const empty: State = { cost: 0, tokens: 0 }

export interface StepUsage {
  cost: number
  tokens: {
    total?: number
    input: number
    output: number
    reasoning: number
    cache: {
      read: number
      write: number
    }
  }
}

/** Accumulate one step-finish part into the running totals. Cache reads and writes count as spend. */
export function add(state: State, part: StepUsage): State {
  const tokens =
    part.tokens.total ??
    part.tokens.input + part.tokens.output + part.tokens.reasoning + part.tokens.cache.read + part.tokens.cache.write
  return {
    cost: state.cost + part.cost,
    tokens: state.tokens + tokens,
  }
}

export interface Limits {
  cost?: number
  tokens?: number
}

/** Describe the first exceeded limit, or undefined while within budget. */
export function exceeded(state: State, limits: Limits) {
  if (limits.cost !== undefined && state.cost >= limits.cost) {
    return `cost budget exceeded: $${state.cost.toFixed(4)} of $${limits.cost} allowed`
  }
  if (limits.tokens !== undefined && state.tokens >= limits.tokens) {
    return `token budget exceeded: ${state.tokens} of ${limits.tokens} allowed`
  }
  return undefined
}

export * as Budget from "./budget"
