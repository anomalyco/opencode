const PTY_NOT_FOUND_MESSAGE = "pty session not found"

function messageText(value: unknown): string | undefined {
  if (typeof value !== "string") return
  const text = value.trim()
  return text.length > 0 ? text : undefined
}

function isPtyNotFoundMessage(value: string | undefined) {
  if (!value) return false
  return value.toLowerCase().includes(PTY_NOT_FOUND_MESSAGE)
}

function hasPtyNotFoundShape(error: unknown, seen = new Set<unknown>()): boolean {
  if (!error || typeof error !== "object") return false
  if (seen.has(error)) return false
  seen.add(error)

  const obj = error as Record<string, unknown>
  if (isPtyNotFoundMessage(messageText(obj.message))) return true
  if (isPtyNotFoundMessage(messageText(obj.detail))) return true
  if (messageText(obj.name) === "PtyNotFoundError") return true

  const data = obj.data
  if (data && typeof data === "object" && hasPtyNotFoundShape(data, seen)) return true

  const body = obj.body
  if (body && typeof body === "object" && hasPtyNotFoundShape(body, seen)) return true

  const cause = obj.cause
  if (cause && typeof cause === "object" && hasPtyNotFoundShape(cause, seen)) return true

  return false
}

export function isPtyNotFoundError(error: unknown) {
  if (typeof error === "string") return isPtyNotFoundMessage(error)
  return hasPtyNotFoundShape(error)
}
