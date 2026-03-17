export function shouldResume(input: { sessionID: string; resume?: boolean; resumed?: string }) {
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
  if (!shouldResume(input)) return input.resumed

  try {
    await input.resumeSession({ sessionID: input.sessionID })
    return input.sessionID
  } catch (err) {
    input.onResumeError(err)
    return undefined
  }
}
