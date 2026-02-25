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
 * Find the latest existing session to reuse instead of creating a new one.
 *
 * Returns `{ id }` of the latest session when sessions exist,
 * or `undefined` when no sessions are available (caller should create one).
 */
export function findReusableSession(
  sessions: { id: string }[],
): { id: string } | undefined {
  if (sessions.length === 0) return undefined
  return { id: sessions[sessions.length - 1].id }
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
