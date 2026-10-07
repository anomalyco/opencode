/**
 * Consecutive tool-failure budget shared by the provider-turn loop.
 *
 * Each turn reports whether any tool succeeded and how many failures trail the
 * last success. A success breaks the streak; otherwise failures accumulate
 * across turns within one drain. The streak trips the moment it reaches the
 * configured limit (`>=`, so the Nth consecutive failure escalates).
 *
 * This is intentionally approximate at two boundaries, both documented for
 * reviewers: outcomes inside one turn collapse to totals (a success followed by
 * failures in the same turn resets before counting the tail, lagging by at most
 * one turn), and only the final fallback attempt of a turn reports outcomes —
 * tool failures from superseded fallback attempts do not extend the streak.
 */
export interface TurnOutcomes {
  /** Whether any tool succeeded during the turn. */
  readonly succeeded: boolean
  /** Failures since the last success within the turn. */
  readonly trailingFailures: number
}

export const observe = (
  streak: number,
  outcome: TurnOutcomes,
  limit: number,
): { readonly streak: number; readonly exceeded: boolean } => {
  const next = outcome.succeeded ? outcome.trailingFailures : streak + outcome.trailingFailures
  return { streak: next, exceeded: next >= limit }
}

export * as ToolBudget from "./tool-budget"
