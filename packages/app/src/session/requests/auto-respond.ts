import { base64Encode } from "@opencode-ai/util/encode"

export function acceptKey(sessionID: string, directory?: string) {
  if (!directory) return sessionID
  return `${base64Encode(directory)}/${sessionID}`
}

export function directoryAcceptKey(directory: string) {
  return `${base64Encode(directory)}/*`
}

function accepted(autoAccept: Record<string, boolean>, sessionID: string, directory?: string) {
  return autoAccept[acceptKey(sessionID, directory)]
}

export function isDirectoryAutoAccepting(autoAccept: Record<string, boolean>, directory: string) {
  const key = directoryAcceptKey(directory)
  return autoAccept[key] ?? false
}

export function relocateAutoAccept(
  autoAccept: Record<string, boolean>,
  sessions: readonly { id: string }[],
  directory: string,
) {
  const moves = sessions.flatMap((session) => {
    const value = autoAccept[session.id]
    if (value === undefined) return []
    return [{ source: session.id, target: acceptKey(session.id, directory), value }]
  })
  if (moves.length === 0) return autoAccept

  const next = { ...autoAccept }
  for (const move of moves) {
    if (next[move.target] === undefined) next[move.target] = move.value
    delete next[move.source]
  }
  return next
}

function sessionLineage(session: { id: string; parentID?: string }[], sessionID: string) {
  const parent = session.reduce((acc, item) => {
    if (item.parentID) acc.set(item.id, item.parentID)
    return acc
  }, new Map<string, string>())
  const seen = new Set([sessionID])
  const ids = [sessionID]

  for (const id of ids) {
    const parentID = parent.get(id)
    if (!parentID || seen.has(parentID)) continue
    seen.add(parentID)
    ids.push(parentID)
  }

  return ids
}

export function autoRespondsPermission(
  autoAccept: Record<string, boolean>,
  session: { id: string; parentID?: string }[],
  permission: { sessionID: string },
  directory?: string,
) {
  const value = sessionAutoAccept(autoAccept, session, permission, directory)
  if (value !== undefined) return value
  return directory ? isDirectoryAutoAccepting(autoAccept, directory) : false
}

export function sessionAutoAccept(
  autoAccept: Record<string, boolean>,
  session: { id: string; parentID?: string }[],
  permission: { sessionID: string },
  directory?: string,
) {
  return sessionLineage(session, permission.sessionID)
    .map((id) => accepted(autoAccept, id, directory))
    .find((item): item is boolean => item !== undefined)
}
