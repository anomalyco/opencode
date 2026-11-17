/** Effective threshold computation, exact body from spec Part A §4.1. */
import type { RolloverConfig } from "./types"

export function effectiveThreshold(a: {
  cfg: RolloverConfig
  sessionOverride?: number
  modelLimit?: number
}): { value: number; source: "session" | "config" | "computed" | "fallback" } {
  const lim = a.modelLimit && a.modelLimit > 0 ? a.modelLimit : 0
  if (a.sessionOverride) return { value: a.sessionOverride, source: "session" }
  if (a.cfg.thresholdTokens) return { value: a.cfg.thresholdTokens, source: "config" }
  if (!lim) return { value: 100_000, source: "fallback" }
  const v = Math.min(Math.floor(lim * a.cfg.thresholdRatio), a.cfg.thresholdCapTokens)
  return { value: Math.max(a.cfg.thresholdMinTokens, v), source: "computed" }
}
