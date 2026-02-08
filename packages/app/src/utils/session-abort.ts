const suppressed = new Map<string, Set<string>>()

export function suppressAbortedError(sessionID: string, messageID: string) {
  const set = suppressed.get(sessionID)
  if (set) {
    set.add(messageID)
    return
  }
  suppressed.set(sessionID, new Set([messageID]))
}

export function isAbortedErrorSuppressed(sessionID: string, messageID: string) {
  return suppressed.get(sessionID)?.has(messageID) ?? false
}
