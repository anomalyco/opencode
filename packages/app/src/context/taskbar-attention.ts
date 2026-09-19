export function taskbarAttentionReady(states: Iterable<{ ready(): boolean }>) {
  return [...states].every((state) => state.ready())
}

export function taskbarUnreadSessions(unseen: Record<string, readonly unknown[]>) {
  return Object.entries(unseen).flatMap(([session, notifications]) =>
    session !== "global" && notifications.length ? [session] : [],
  )
}

export function createTaskbarAttentionState() {
  const pending = new Map<string, Set<string>>()
  const synced = new Map<string, string>()
  const syncHistory = new Map<string, string>()
  const dismissed = new Set<string>()
  const requestIDs = (token: string) =>
    new Set(
      token.split("|").flatMap((part) =>
        part
          .slice(part.indexOf(":") + 1)
          .split(",")
          .filter(Boolean),
      ),
    )

  const sessions = (unread: readonly string[]) => {
    const active = new Set([...unread, ...pending.keys(), ...synced.keys()])
    dismissed.forEach((sessionID) => {
      if (!active.has(sessionID)) dismissed.delete(sessionID)
    })
    return [...active].filter((sessionID) => !dismissed.has(sessionID))
  }

  return {
    add(sessionID: string, token = "attention") {
      const tokens = pending.get(sessionID) ?? new Set<string>()
      tokens.add(token)
      pending.set(sessionID, tokens)
      dismissed.delete(sessionID)
    },
    remove(sessionID: string) {
      pending.delete(sessionID)
      dismissed.add(sessionID)
    },
    removePending(sessionID: string, token: string) {
      const tokens = pending.get(sessionID)
      if (!tokens) return
      tokens.delete(token)
      if (tokens.size === 0) pending.delete(sessionID)
    },
    sync(next: readonly { sessionID: string; token: string }[]) {
      const current = new Map(next.map((item) => [item.sessionID, item.token]))
      pending.forEach((tokens, sessionID) => {
        if (!current.has(sessionID) && !syncHistory.has(sessionID)) return
        const active = new Set((current.get(sessionID) ?? "").split("|"))
        tokens.forEach((token) => {
          if ((token.startsWith("permission:") || token.startsWith("question:")) && !active.has(token)) {
            tokens.delete(token)
          }
        })
        if (tokens.size === 0) pending.delete(sessionID)
      })
      current.forEach((token, sessionID) => {
        const previous = syncHistory.get(sessionID)
        if (!previous) return
        const previousIDs = requestIDs(previous)
        if ([...requestIDs(token)].some((id) => !previousIDs.has(id))) dismissed.delete(sessionID)
      })
      syncHistory.forEach((_, sessionID) => {
        if (current.has(sessionID)) return
        syncHistory.delete(sessionID)
        dismissed.delete(sessionID)
      })
      current.forEach((token, sessionID) => syncHistory.set(sessionID, token))
      synced.clear()
      current.forEach((token, sessionID) => synced.set(sessionID, token))
    },
    sessions,
    count(unread: readonly string[]) {
      return sessions(unread).length
    },
  }
}
