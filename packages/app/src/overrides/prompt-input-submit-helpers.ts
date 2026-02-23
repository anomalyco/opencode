/**
 * Resolve session when the sync store hasn't caught up yet.
 *
 * When params.id is set but the session object isn't in the sync store,
 * fall back to using the ID directly so the prompt can still be sent.
 */
export function resolveSession(
  session: { id: string } | undefined,
  isNewSession: boolean,
  paramsId: string | undefined,
): { id: string } | undefined {
  if (session) return session
  if (isNewSession) return undefined
  if (paramsId) return { id: paramsId }
  return undefined
}

/**
 * Extract a human-readable message from various error shapes.
 *
 * Handles API-style errors with `data.message`, standard Error instances,
 * and falls back to the provided default string.
 */
export function extractErrorMessage(err: unknown, fallback: string): string {
  if (err && typeof err === "object" && "data" in err) {
    const data = (err as { data?: { message?: string } }).data
    if (data?.message) return data.message
  }
  if (err instanceof Error) return err.message
  return fallback
}
