import path from "path"

export type ContinueSession = {
  id: string
  parentID?: string
  directory?: string
  time: { updated: number }
  location?: { directory?: string }
}

function sessionDirectory(session: ContinueSession) {
  const directory = session.location?.directory ?? session.directory
  return directory ? path.resolve(directory) : undefined
}

/** Prefer the session the user last exited/viewed; fall back to most recently updated root. */
export function resolveContinueSessionID(
  sessions: readonly ContinueSession[],
  input: { lastID?: string; directory?: string } = {},
) {
  const target = input.directory ? path.resolve(input.directory) : undefined

  if (input.lastID) {
    const hit = sessions.find((session) => session.id === input.lastID)
    if (hit) {
      const id = hit.parentID ?? hit.id
      if (!target) return id
      if (sessionDirectory(hit) === target) return id
    }
  }

  return sessions
    .filter((session) => session.parentID === undefined)
    .filter((session) => {
      if (!target) return true
      return sessionDirectory(session) === target
    })
    .toSorted((a, b) => b.time.updated - a.time.updated)[0]?.id
}
