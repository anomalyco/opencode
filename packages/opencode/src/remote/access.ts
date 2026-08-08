import { randomBytes } from "node:crypto"
import type { SessionID } from "@/session/schema"

const PAIR_TTL_MS = 5 * 60 * 1000
const GRANT_TTL_MS = 12 * 60 * 60 * 1000

type Pairing = {
  sessionID: SessionID
  expiresAt: number
}

type Grant = {
  sessionID: SessionID
  expiresAt: number
}

const pairings = new Map<string, Pairing>()
const grants = new Map<string, Grant>()

function token() {
  return randomBytes(32).toString("base64url")
}

function prune(now = Date.now()) {
  for (const [key, value] of pairings) {
    if (value.expiresAt <= now) pairings.delete(key)
  }
  for (const [key, value] of grants) {
    if (value.expiresAt <= now) grants.delete(key)
  }
}

export namespace RemoteAccess {
  export function pair(sessionID: SessionID, now = Date.now()) {
    prune(now)
    const ticket = token()
    pairings.set(ticket, { sessionID, expiresAt: now + PAIR_TTL_MS })
    return { ticket, expires_in: Math.floor(PAIR_TTL_MS / 1000) }
  }

  export function redeem(ticket: string, now = Date.now()) {
    prune(now)
    const pairing = pairings.get(ticket)
    if (!pairing) return
    pairings.delete(ticket)
    if (pairing.expiresAt <= now) return

    const accessToken = token()
    grants.set(accessToken, { sessionID: pairing.sessionID, expiresAt: now + GRANT_TTL_MS })
    return {
      token: accessToken,
      sessionID: pairing.sessionID,
      expires_in: Math.floor(GRANT_TTL_MS / 1000),
    }
  }

  export function authorized(accessToken: string, sessionID: string, now = Date.now()) {
    prune(now)
    const grant = grants.get(accessToken)
    if (!grant || grant.expiresAt <= now) return false
    return grant.sessionID === sessionID
  }

  export function revoke(sessionID: SessionID) {
    for (const [key, value] of pairings) {
      if (value.sessionID === sessionID) pairings.delete(key)
    }
    for (const [key, value] of grants) {
      if (value.sessionID === sessionID) grants.delete(key)
    }
  }

  export function resetForTest() {
    pairings.clear()
    grants.clear()
  }
}
