import { base64Encode } from "@opencode-ai/core/util/encode"
import { ServerConnection } from "@/context/server"
import { decode64 } from "@/utils/base64"

export function sessionHref(server: ServerConnection.Key, sessionID: string) {
  return `/server/${base64Encode(server)}/session/${sessionID}`
}

export function legacySessionHref(directory: string, sessionID: string) {
  return `/${base64Encode(directory)}/session/${sessionID}`
}

export function requireServerKey(segment: string | undefined) {
  const key = decode64(segment)
  if (!key || base64Encode(key) !== segment) throw new Error("Invalid server route")
  return ServerConnection.Key.make(key)
}

type SessionParent = { id: string; parentID?: string }

export async function rootSession(session: SessionParent, get: (sessionID: string) => Promise<SessionParent>) {
  let current = session
  while (current.parentID) current = await get(current.parentID)
  return current
}
