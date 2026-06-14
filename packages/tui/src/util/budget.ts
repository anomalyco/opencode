export type HealthTone = "muted" | "warning" | "error"

const DEFAULT_WARN_AT = [0.5, 0.8]

/**
 * Compute a session's spend-vs-cap view for the footer health indicator.
 *
 * Returns `undefined` when no cap is configured (budget guard disabled), so the
 * widget can simply not render. Tone escalates as spend approaches the cap:
 * the lowest `warn_at` threshold turns it `warning`, the highest threshold (or
 * crossing 100%) turns it `error`.
 */
export function budgetView(
  spent: number,
  cap: number | undefined,
  warnAt?: number[],
): { pct: number; tone: HealthTone } | undefined {
  if (!cap || cap <= 0) return undefined
  const pct = spent / cap

  const thresholds = (warnAt ?? DEFAULT_WARN_AT).filter((x) => x > 0).toSorted((a, b) => a - b)
  const lo = thresholds[0] ?? DEFAULT_WARN_AT[0]
  const hi = thresholds[thresholds.length - 1] ?? DEFAULT_WARN_AT[1]

  let tone: HealthTone = "muted"
  if (pct >= lo) tone = "warning"
  if (pct >= hi || pct >= 1) tone = "error"

  return { pct, tone }
}

/**
 * Tone for the ACE cascade growth factor (k_eff). 1.0 is the stable line
 * (each agent spawns at most one), so below that is healthy, and runaway
 * branching (>= 1.5) is flagged as error.
 */
export function kEffTone(kEff: number | undefined): HealthTone {
  if (kEff === undefined) return "muted"
  if (kEff >= 1.5) return "error"
  if (kEff >= 1.0) return "warning"
  return "muted"
}
