const prefix = "opencode-actor"

export function actorKey(sessionID: string) {
  return `${prefix}:${sessionID}`
}

export function loadActor(sessionID: string) {
  return sessionStorage.getItem(actorKey(sessionID)) ?? undefined
}

export function saveActor(sessionID: string, actorID: string) {
  sessionStorage.setItem(actorKey(sessionID), actorID)
}

export function clearActor(sessionID: string) {
  sessionStorage.removeItem(actorKey(sessionID))
}
