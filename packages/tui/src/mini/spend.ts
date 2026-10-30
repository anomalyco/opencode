import type { CostMessage, CostModel, CostSession } from "../util/session"
import { costEstimate } from "../util/session"

export type SessionSpend = { estimate?: number }

/**
 * Catalog-price estimate for the mini footer status line. The opt-in experiment
 * only fills in sessions with no recorded cost; a reported cost stays authoritative.
 */
export function sessionSpend(input: {
  enabled: boolean
  session: CostSession | undefined
  models: ReadonlyArray<CostModel> | undefined
  messages: ReadonlyArray<CostMessage>
}): SessionSpend {
  if (!input.enabled) return {}
  const session = input.session
  if (!session) return {}
  if ((session.cost ?? 0) > 0) return {}
  const estimate = costEstimate([session], input.models, () => input.messages)
  if (estimate === undefined || estimate <= 0) return {}
  return { estimate }
}
