import { base64Encode } from "@opencode/util/encode"
import { ServerConnection } from "@/runtime/server/registry"
import { decode64 } from "@/runtime/persistence/base64"

export function sessionHref(server: ServerConnection.Key, sessionID: string) {
  return `/server/${base64Encode(server)}/session/${sessionID}`
}

// Same encoding rule as sessionHref: the raw key can contain path characters, so the
// URL segment must be the base64 form that requireServerKey decodes back.
export function tradingHref(server: ServerConnection.Key, sessionID: string) {
  return `/trading/${base64Encode(server)}/${sessionID}`
}

// `/trading`'s starting point: the view resolves its own dedicated chat there, which
// starts empty on every app or window restart.
export function tradingNewHref(server: ServerConnection.Key) {
  return `/trading/${base64Encode(server)}/new`
}

export function requireServerKey(segment: string | undefined) {
  const key = decode64(segment)

  if (!key || base64Encode(key) !== segment) throw new Error("Invalid server route")

  return ServerConnection.Key.make(key)
}

type SessionParent = { id: string; parentID?: string }

export async function rootSession<T extends SessionParent>(session: T, get: (sessionID: string) => Promise<T>) {
  const seen = new Set([session.id])
  let current = session

  while (current.parentID) {
    if (seen.has(current.parentID)) throw new Error(`Session parent cycle: ${current.parentID}`)
    seen.add(current.parentID)
    current = await get(current.parentID)
  }

  return current
}
