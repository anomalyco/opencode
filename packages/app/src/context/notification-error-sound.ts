export function createNotificationErrorSound() {
  const muted = new Set<string>()

  return {
    muteNext(sessionID: string) {
      muted.add(sessionID)
      return () => {
        muted.delete(sessionID)
      }
    },
    shouldPlay(sessionID?: string) {
      if (!sessionID) return true
      return !muted.delete(sessionID)
    },
    settle(sessionID?: string) {
      if (sessionID) muted.delete(sessionID)
    },
    dispose() {
      muted.clear()
    },
  }
}
