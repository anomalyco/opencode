import path from "path"
import { normalizePath } from "./path"

export type ContinueSession = {
  id: string
  parentID?: string
  directory?: string
  time: { updated: number }
  location?: { directory?: string }
}

function sessionDirectory(session: ContinueSession) {
  return session.location?.directory ?? session.directory
}

/** Compare project paths; Windows must ignore drive/letter casing and slash style. */
function sameDirectory(left: string, right: string, platform: NodeJS.Platform = process.platform) {
  if (platform === "win32") {
    return normalizePath(left, platform).toLowerCase() === normalizePath(right, platform).toLowerCase()
  }
  return path.resolve(left) === path.resolve(right)
}

function matchesDirectory(session: ContinueSession, target: string, platform: NodeJS.Platform = process.platform) {
  const directory = sessionDirectory(session)
  if (!directory) return false
  return sameDirectory(directory, target, platform)
}

/** Prefer the session the user last exited/viewed; fall back to most recently updated root. */
export function resolveContinueSessionID(
  sessions: readonly ContinueSession[],
  input: { lastID?: string; directory?: string; platform?: NodeJS.Platform } = {},
) {
  const platform = input.platform ?? process.platform
  const target = input.directory

  if (input.lastID) {
    const hit = sessions.find((session) => session.id === input.lastID)
    if (hit) {
      const id = hit.parentID ?? hit.id
      if (!target) return id
      if (matchesDirectory(hit, target, platform)) return id
    }
  }

  return sessions
    .filter((session) => session.parentID === undefined)
    .filter((session) => {
      if (!target) return true
      return matchesDirectory(session, target, platform)
    })
    .toSorted((a, b) => b.time.updated - a.time.updated)[0]?.id
}
