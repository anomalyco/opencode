import { createHash, randomBytes } from "node:crypto"
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

function key(value: string) {
  return createHash("sha256").update(value).digest("base64url")
}

function prune(now = Date.now()) {
  for (const [id, value] of pairings) {
    if (value.expiresAt <= now) pairings.delete(id)
  }
  for (const [id, value] of grants) {
    if (value.expiresAt <= now) grants.delete(id)
  }
}

function revokePairings(sessionID: SessionID) {
  for (const [id, value] of pairings) {
    if (value.sessionID === sessionID) pairings.delete(id)
  }
}

function revokeGrants(sessionID: SessionID) {
  for (const [id, value] of grants) {
    if (value.sessionID === sessionID) grants.delete(id)
  }
}

export function pair(sessionID: SessionID, now = Date.now()) {
  prune(now)
  revokePairings(sessionID)
  const ticket = token()
  pairings.set(key(ticket), { sessionID, expiresAt: now + PAIR_TTL_MS })
  return { ticket, expires_in: Math.floor(PAIR_TTL_MS / 1000) }
}

export function redeem(ticket: string, now = Date.now()) {
  prune(now)
  const ticketKey = key(ticket)
  const pairing = pairings.get(ticketKey)
  if (!pairing) return
  pairings.delete(ticketKey)
  if (pairing.expiresAt <= now) return

  revokeGrants(pairing.sessionID)
  const accessToken = token()
  grants.set(key(accessToken), { sessionID: pairing.sessionID, expiresAt: now + GRANT_TTL_MS })
  return {
    token: accessToken,
    sessionID: pairing.sessionID,
    expires_in: Math.floor(GRANT_TTL_MS / 1000),
  }
}

export function authorized(accessToken: string, sessionID: string, now = Date.now()) {
  prune(now)
  const grant = grants.get(key(accessToken))
  if (!grant || grant.expiresAt <= now) return false
  return grant.sessionID === sessionID
}

export function revoke(sessionID: SessionID) {
  revokePairings(sessionID)
  revokeGrants(sessionID)
}

export function resetForTest() {
  pairings.clear()
  grants.clear()
}

export * as RemoteAccess from "./access"
