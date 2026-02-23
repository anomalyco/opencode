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
