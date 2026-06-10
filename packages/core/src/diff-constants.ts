// Messages API returns ALL diffs per session, so use conservative 100KB limit.
export const MAX_INFO_DIFF_PATCH_BYTES = 100_000

// Frontend skip content reconstruction for patches >100KB (defense-in-depth).
export const MAX_RECONSTRUCT_BYTES = 100_000

// Per-file patch generation limit. Dedicated diff endpoints serve one file at a
// time, so 1MB is acceptable.
export const MAX_DIFF_PATCH_BYTES = 1_000_000

// Absolute fallback: even with context=0, discard patches >10MB.
export const ABSOLUTE_MAX_DIFF_BYTES = 10_000_000
