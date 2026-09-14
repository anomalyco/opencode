export type CostSample = { t: number; cost: number; tokens: number; provider: string; model: string }

export type ModelCost = {
  provider: string
  model: string
  cost: number
  tokens: number
  windowCost: number
  windowTokens: number
}

export type CostBreakdown = {
  total: { cost: number; tokens: number }
  window: { cost: number; tokens: number; costPerHour: number; tokensPerMin: number }
  byModel: ModelCost[]
}

const clean = (v: number) => (Number.isFinite(v) && v > 0 ? v : 0)

/** Spend and burn over all samples and over the window (now-secs, now]. */
export function costBreakdown(samples: CostSample[], now: number, secs: number): CostBreakdown {
  const total = { cost: 0, tokens: 0 }
  const window = { cost: 0, tokens: 0 }
  const models = new Map<string, ModelCost>()
  for (const sample of samples) {
    const cost = clean(sample.cost)
    const tokens = clean(sample.tokens)
    const inWindow = sample.t > now - secs && sample.t <= now
    total.cost += cost
    total.tokens += tokens
    const key = `${sample.provider}/${sample.model}`
    const entry = models.get(key) ?? {
      provider: sample.provider,
      model: sample.model,
      cost: 0,
      tokens: 0,
      windowCost: 0,
      windowTokens: 0,
    }
    entry.cost += cost
    entry.tokens += tokens
    if (inWindow) {
      window.cost += cost
      window.tokens += tokens
      entry.windowCost += cost
      entry.windowTokens += tokens
    }
    models.set(key, entry)
  }
  const span = secs > 0 ? secs : 1
  return {
    total,
    window: { ...window, costPerHour: (window.cost / span) * 3600, tokensPerMin: (window.tokens / span) * 60 },
    byModel: [...models.values()].sort((a, b) => b.windowCost - a.windowCost || b.cost - a.cost),
  }
}
