// Item 24: shared per-TURN budget pool. ONE pool is created per prompt turn
// (SessionPrompt.prompt) and shared by the main loop (chargeDirect on each
// step-finish) and EVERY nested run the turn starts (reserve/settle around
// each ctx.agent step) — so two runs of the same turn compete for the same
// USD headroom instead of each getting its own cap.
//
// The pool is turn-scoped and IN-MEMORY by design: it binds to exactly one
// prompt turn, and plain object-reference sharing carries it everywhere it
// needs to go (a background run keeps holding the reference past the turn's
// end; the main loop simply stops charging once the turn finished). It is
// deliberately NOT persisted (InstanceState/DB) — a resume turn brings its own
// fresh pool.
//
// ATOMICITY: `reserve` is a synchronous check-and-set with no await in
// between. Bun is single-threaded, so no other fiber can interleave between
// the headroom check and the reservation — this closes the audited soft-cap
// race of the per-run budget gate (N parallel steps could all pass a
// check-only gate before any of them charged). The known residual: with
// `avgStepUsd === 0` (no settled step yet) reservations are free, so the
// FIRST parallel wave can still overspend bounded by its in-flight cost —
// exactly the per-run soft cap's documented bound.
//
// The `tokens` limit is structurally prepared (Item 17 supplies the token
// telemetry) but the reservation itself is USD-denominated; a tokens-only
// pool gates on committed tokens at reserve time.

export type Limit = { total: number; committed: number; reserved: number }

export type Pool = {
  id: string
  usd?: Limit
  tokens?: Limit
  /**
   * Rolling average USD cost of a settled step — the reservation ESTIMATE for
   * the next step. Starts at 0 (free reservations until the first settlement;
   * see the residual soft-cap note above).
   */
  avgStepUsd: number
  /** Number of settled steps feeding `avgStepUsd`. */
  steps: number
}

export type Reservation = { usd: number }

let counter = 0

export function make(input: { usd?: number; tokens?: number }): Pool {
  counter += 1
  return {
    id: `turnpool_${counter}`,
    usd: input.usd !== undefined ? { total: input.usd, committed: 0, reserved: 0 } : undefined,
    tokens: input.tokens !== undefined ? { total: input.tokens, committed: 0, reserved: 0 } : undefined,
    avgStepUsd: 0,
    steps: 0,
  }
}

/**
 * SYNCHRONOUS check-and-set: refuses (returns undefined) when any configured
 * limit is exhausted (committed + reserved >= total), otherwise reserves
 * `estimateUsd` against the USD limit and returns the reservation the caller
 * MUST later `settle` (ensuring-style, on every outcome) so reserved headroom
 * can never leak.
 */
export function reserve(pool: Pool, estimateUsd: number): Reservation | undefined {
  if (pool.usd !== undefined && pool.usd.committed + pool.usd.reserved >= pool.usd.total) return undefined
  if (pool.tokens !== undefined && pool.tokens.committed + pool.tokens.reserved >= pool.tokens.total) return undefined
  const usd = Math.max(0, estimateUsd)
  if (pool.usd !== undefined) pool.usd.reserved += usd
  return { usd }
}

/**
 * Releases a reservation and commits the step's ACTUAL spend (0 for an
 * aborted/cancelled step — the caller decides), advancing the rolling
 * per-step average that prices the next reservation.
 */
export function settle(pool: Pool, reservation: Reservation, actual: { usd: number; tokens?: number }): void {
  if (pool.usd !== undefined) {
    pool.usd.reserved = Math.max(0, pool.usd.reserved - reservation.usd)
    pool.usd.committed += actual.usd
  }
  if (pool.tokens !== undefined && actual.tokens !== undefined) pool.tokens.committed += actual.tokens
  pool.steps += 1
  pool.avgStepUsd = pool.avgStepUsd + (actual.usd - pool.avgStepUsd) / pool.steps
}

/**
 * Main-loop charging: commits actual spend WITHOUT a reservation and is NEVER
 * gated — the turn's own model loop must not be refused by its own pool; the
 * pool throttles the nested runs it spawned.
 */
export function chargeDirect(pool: Pool, actual: { usd: number; tokens?: number }): void {
  if (pool.usd !== undefined) pool.usd.committed += actual.usd
  if (pool.tokens !== undefined && actual.tokens !== undefined) pool.tokens.committed += actual.tokens
}

export function remaining(pool: Pool): { usd?: number; tokens?: number } {
  return {
    usd: pool.usd !== undefined ? Math.max(0, pool.usd.total - pool.usd.committed - pool.usd.reserved) : undefined,
    tokens:
      pool.tokens !== undefined
        ? Math.max(0, pool.tokens.total - pool.tokens.committed - pool.tokens.reserved)
        : undefined,
  }
}

export * as TurnBudget from "./turn-budget"
