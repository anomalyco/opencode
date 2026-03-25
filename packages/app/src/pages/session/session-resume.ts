const skipped = new Set<string>()

export function skipSessionResume(sessionID: string) {
  skipped.add(sessionID)
}

export function takeSessionResume(sessionID: string) {
  if (!skipped.has(sessionID)) return true
  skipped.delete(sessionID)
  return false
}

export function shouldResumeSession(input: { sessionID: string; resume?: boolean; resumed?: string }) {
  return input.resume !== false && input.resumed !== input.sessionID
}

export async function syncSession(input: {
  sessionID: string
  resume?: boolean
  resumed?: string
  sync: (sessionID: string) => Promise<unknown>
  resumeSession: (input: { sessionID: string }) => Promise<unknown>
  onScroll?: () => void
  onResumeError: (err: unknown) => void
  onSyncError: (err: unknown) => void
  onMissing: () => void
}) {
  try {
    await input.sync(input.sessionID)
  } catch (err) {
    input.onSyncError(err)
    input.onMissing()
    return input.resumed
  }

  input.onScroll?.()
  if (!shouldResumeSession(input)) return input.resumed

  try {
    await input.resumeSession({ sessionID: input.sessionID })
    return input.sessionID
  } catch (err) {
    input.onResumeError(err)
    return undefined
  }
}
