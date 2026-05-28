const accepted = new Set<string>()

function key(sessionID: string, directory?: string) {
  return `${directory ?? ""}:${sessionID}`
}

export function usePermission() {
  return {
    autoResponds() {
      return false
    },
    isAutoAccepting(sessionID: string, directory?: string) {
      return accepted.has(key(sessionID, directory))
    },
    toggleAutoAccept(sessionID: string, directory?: string) {
      const next = key(sessionID, directory)
      if (accepted.has(next)) {
        accepted.delete(next)
        return
      }
      accepted.add(next)
    },
  }
}
