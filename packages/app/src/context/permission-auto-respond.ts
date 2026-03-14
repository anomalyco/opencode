import { base64Encode } from "@opencode-ai/util/encode"

type Source = "session" | "directory" | "global"

export function globalAcceptKey() {
  return "*"
}

export function acceptKey(sessionID: string, directory?: string) {
  if (!directory) return sessionID
  return `${base64Encode(directory)}/${sessionID}`
}

export function directoryAcceptKey(directory: string) {
  return `${base64Encode(directory)}/*`
}

function accepted(autoAccept: Record<string, boolean>, sessionID: string, directory?: string) {
  const key = acceptKey(sessionID, directory)
  const directoryKey = directory ? directoryAcceptKey(directory) : undefined
  return (
    autoAccept[key] ??
    autoAccept[sessionID] ??
    (directoryKey ? autoAccept[directoryKey] : undefined) ??
    autoAccept[globalAcceptKey()]
  )
}

function acceptedSource(
  autoAccept: Record<string, boolean>,
  sessionID: string,
  directory?: string,
): Source | undefined {
  const key = acceptKey(sessionID, directory)
  if (autoAccept[key] !== undefined) return "session"
  if (autoAccept[sessionID] !== undefined) return "session"
  if (directory) {
    const key = directoryAcceptKey(directory)
    if (autoAccept[key] !== undefined) return "directory"
  }
  if (autoAccept[globalAcceptKey()] !== undefined) return "global"
}

export function isGlobalAutoAccepting(autoAccept: Record<string, boolean>) {
  return autoAccept[globalAcceptKey()] ?? false
}

export function isDirectoryAutoAccepting(autoAccept: Record<string, boolean>, directory: string) {
  const key = directoryAcceptKey(directory)
  return autoAccept[key] ?? autoAccept[globalAcceptKey()] ?? false
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
  const value = sessionLineage(session, permission.sessionID)
    .map((id) => accepted(autoAccept, id, directory))
    .find((item): item is boolean => item !== undefined)
  return value ?? false
}

export function autoRespondsPermissionSource(
  autoAccept: Record<string, boolean>,
  session: { id: string; parentID?: string }[],
  permission: { sessionID: string },
  directory?: string,
) {
  return sessionLineage(session, permission.sessionID)
    .map((id) => ({ source: acceptedSource(autoAccept, id, directory), value: accepted(autoAccept, id, directory) }))
    .find((item): item is { source: Source; value: boolean } => item.source !== undefined && item.value !== undefined)
    ?.source
}
