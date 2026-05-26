function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

export function isSessionNotFoundError(error: unknown) {
  if (!(error instanceof Error)) return false
  if (!isRecord(error.cause)) return false
  if (error.cause.status !== 404) return false
  if (!isRecord(error.cause.body)) return false

  if (error.cause.body.name === "SessionNotFoundError") return true
  if (error.cause.body._tag === "SessionNotFoundError") return true
  if (error.cause.body.name !== "NotFoundError") return false

  const data = isRecord(error.cause.body.data) ? error.cause.body.data : undefined
  return typeof data?.message === "string" && data.message.startsWith("Session not found:")
}

export async function recoverSessionNotFound<T>(promise: Promise<T>, recover: () => void) {
  try {
    return await promise
  } catch (error) {
    if (!isSessionNotFoundError(error)) throw error
    recover()
  }
}
