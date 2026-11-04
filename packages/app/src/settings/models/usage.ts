import type { SessionStatsInfo } from "@opencode/client/promise"

/** What one model generated locally, summed across its variants. */
export type ModelUsage = {
  readonly steps: number
  readonly generated: number
}

/**
 * Generated tokens per model from the session stats. A model can have steps without generating anything, for example
 * when every request failed, so `steps` and `generated` stay separate.
 */
export function usageByModel(stats: SessionStatsInfo) {
  const usage = new Map<string, ModelUsage>()

  stats.models.forEach((item) => {
    const key = `${item.model.providerID}:${item.model.id}`
    const current = usage.get(key)

    usage.set(key, {
      steps: (current?.steps ?? 0) + item.steps,
      generated: (current?.generated ?? 0) + item.tokens.output + item.tokens.reasoning,
    })
  })

  return usage
}
