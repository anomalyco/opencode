import { useParams } from "@solidjs/router"
import { SessionID } from "@opencode/schema/session-id"
import { base64Encode } from "@opencode/util/encode"
import { ServerConnection } from "@/runtime/server/registry"
import { decode64 } from "@/runtime/persistence/base64"

export function sessionHref(server: ServerConnection.Key, sessionID: SessionID) {
  return `/server/${base64Encode(server)}/session/${sessionID}`
}

export function requireServerKey(segment: string | undefined) {
  const key = decode64(segment)
  if (!key || base64Encode(key) !== segment) throw new Error("Invalid server route")
  return ServerConnection.Key.make(key)
}

type SessionParent = { id: SessionID; parentID?: SessionID }

export async function rootSession<T extends SessionParent>(session: T, get: (sessionID: SessionID) => Promise<T>) {
  const seen = new Set([session.id])
  let current = session
  while (current.parentID) {
    if (seen.has(current.parentID)) throw new Error(`Session parent cycle: ${current.parentID}`)
    seen.add(current.parentID)
    current = await get(current.parentID)
  }
  return current
}

// Route tokens retain server-owned validation while internal consumers carry their ID identity.
export function useSessionParams() {
  const params = useParams<{ id?: string; dir?: string; serverKey: string }>()
  return {
    get id() {
      return params.id ? SessionID.make(params.id, { disableChecks: true }) : undefined
    },
    get dir() {
      return params.dir
    },
    get serverKey() {
      return params.serverKey
    },
  }
}
