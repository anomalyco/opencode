/**
 * Per-collab-session internal auth token.
 *
 * Replaces the shared `OPENCODE_SERVER_PASSWORD` basic-auth header that
 * `nativeFetch` used to send for server-internal self-calls into the
 * native opencode HttpApi.  See ADR-0001 (Phase 3).
 *
 * Tokens are minted on demand for a `collabSessionId`, held in a process-
 * local Map (never persisted, never leaves the container), and verified
 * with `timingSafeEqual`.  Scoping per collab session bounds the blast
 * radius if one token ever leaked: it grants access only to the workspace
 * directory and native session owned by that one collab session, not to
 * every workspace on the box.
 *
 * Lifecycle:
 *   - `mint(id)`   — generates if absent; returns the existing token on
 *                    every subsequent call (idempotent for the same id).
 *   - `revoke(id)` — drops the entry; called on collab session delete.
 *   - Tokens are lost on process restart and re-minted lazily.  This is
 *     fine because the only consumers are in-process callers that always
 *     mint immediately before using.
 */
import { randomBytes, timingSafeEqual } from "node:crypto"

/**
 * Outbound + inbound header names.  Kept here so middleware and
 * `native-api` agree on the wire format.
 */
export const INTERNAL_TOKEN_HEADER = "x-opencode-internal-token"
export const INTERNAL_COLLAB_SESSION_HEADER = "x-opencode-collab-session"

const tokens = new Map<string, string>()

/** Generate or return the existing internal token for a collab session. */
export function mintInternalToken(collabSessionId: string): string {
  const existing = tokens.get(collabSessionId)
  if (existing) return existing
  const token = randomBytes(32).toString("hex")
  tokens.set(collabSessionId, token)
  return token
}

/** Drop the token entry — call from `deleteCollabSession`. */
export function revokeInternalToken(collabSessionId: string): void {
  tokens.delete(collabSessionId)
}

/**
 * Constant-time compare of a candidate token against the in-memory entry
 * for `collabSessionId`.  Returns false when no entry exists or lengths
 * differ.
 */
export function verifyInternalToken(collabSessionId: string, candidate: string): boolean {
  const expected = tokens.get(collabSessionId)
  if (!expected) return false
  if (candidate.length !== expected.length) return false
  const a = Buffer.from(candidate)
  const b = Buffer.from(expected)
  return timingSafeEqual(a, b)
}

/**
 * Decision helper used by both auth middlewares.  `token` and
 * `collabSessionId` come from inbound request headers (extracted however
 * the caller prefers — Headers, Effect HttpServerRequest, etc.).
 */
export function internalTokenAuthorizes(
  token: string | null | undefined,
  collabSessionId: string | null | undefined,
): boolean {
  if (!token || !collabSessionId) return false
  return verifyInternalToken(collabSessionId, token)
}
