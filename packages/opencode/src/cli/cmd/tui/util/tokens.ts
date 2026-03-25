/**
 * Token usage formatting utilities for the TUI footer display.
 *
 * Provides compact formatting for token counts (K/M suffixes)
 * and tokens-per-second calculation during streaming.
 */

/**
 * Format a token count with compact suffixes.
 * 0-999: "123"
 * 1,000-999,999: "1.2K" (rolls to M at boundary)
 * 1,000,000+: "1.2M"
 */
export function formatTokenCount(count: number): string {
  if (count < 1_000) return count.toString()
  if (count < 1_000_000) {
    const k = count / 1_000
    if (Math.round(k) >= 1_000) return "1.0M"
    return k >= 10 ? `${Math.round(k)}K` : `${k.toFixed(1)}K`
  }
  const m = count / 1_000_000
  return m >= 10 ? `${Math.round(m)}M` : `${m.toFixed(1)}M`
}

/**
 * Format tokens-per-second with appropriate precision.
 * <1: "<1"
 * 1-9.9: "5.7" (one decimal)
 * 10+: "142" (integer)
 */
export function formatTps(tps: number): string {
  if (tps < 1) return "<1"
  if (tps < 9.95) return tps.toFixed(1)
  return Math.round(tps).toString()
}
