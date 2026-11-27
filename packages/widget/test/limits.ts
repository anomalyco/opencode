// Wall-clock limits for tests. The step timeout and the live slice guard real hosts, and the tests that prove them set
// them; elsewhere a loaded machine mustn't fail a test, so runs get limits no test comes near.
export const UNHURRIED_MS = 60_000
/** Step options without the 250 ms step timeout. */
export const STEP = { timeoutMs: UNHURRIED_MS } as const
/** Live options without the 50 ms slice. */
export const LIVE = { busyMs: UNHURRIED_MS } as const
