// Collaborative identity storage.
//
// Two modes:
//  - With an explicit user (?user=<id>||<name>): identity is keyed by that user id and persists in
//    localStorage (shared across tabs of the browser) AND is de-duped server-side by user id — so the
//    SAME user is one collaborator everywhere, and DIFFERENT users are distinct collaborators (→ they
//    must consent to each other's sends).
//  - Without a user param: identity is per TAB (sessionStorage) — each tab is its own collaborator, so
//    opening several tabs lets you simulate several participants.
const prefix = "opencode-actor"

function tabKey(sessionID: string) {
  return `${prefix}:${sessionID}`
}

function userKey(sessionID: string, userID: string) {
  return `${prefix}:${sessionID}:user:${userID}`
}

export function actorKey(sessionID: string, userID?: string) {
  return userID ? userKey(sessionID, userID) : tabKey(sessionID)
}

export function loadActor(sessionID: string, userID?: string) {
  try {
    if (userID) return localStorage.getItem(userKey(sessionID, userID)) ?? undefined
    return sessionStorage.getItem(tabKey(sessionID)) ?? undefined
  } catch {
    return undefined
  }
}

export function saveActor(sessionID: string, actorID: string, userID?: string) {
  try {
    if (userID) localStorage.setItem(userKey(sessionID, userID), actorID)
    else sessionStorage.setItem(tabKey(sessionID), actorID)
  } catch {
    // ignore storage access errors
  }
}

export function clearActor(sessionID: string, userID?: string) {
  try {
    if (userID) localStorage.removeItem(userKey(sessionID, userID))
    else sessionStorage.removeItem(tabKey(sessionID))
  } catch {
    // ignore
  }
}
