/**
 * Pick the latest session and build a navigation path.
 *
 * Returns `undefined` when no redirect is needed (paramsId already set
 * or no sessions available). Otherwise returns the path to the last session.
 */
export function resolveLatestSessionPath(
  paramsId: string | undefined,
  paramsDir: string | undefined,
  sessions: { id: string }[],
): string | undefined {
  if (paramsId) return undefined
  if (sessions.length === 0) return undefined
  const latest = sessions[sessions.length - 1]
  return `/${paramsDir}/session/${latest.id}`
}

/**
 * Guard that ensures auto-select fires only once per mount.
 *
 * On first call with a valid path, returns the path and locks.
 * All subsequent calls return `undefined` regardless of input.
 * This prevents "New session" clicks from being redirected back.
 */
export function createAutoSelectGuard() {
  let done = false

  return function tryAutoSelect(
    paramsId: string | undefined,
    paramsDir: string | undefined,
    sessions: { id: string }[],
  ): string | undefined {
    if (done) return undefined
    const path = resolveLatestSessionPath(paramsId, paramsDir, sessions)
    if (path) done = true
    return path
  }
}
