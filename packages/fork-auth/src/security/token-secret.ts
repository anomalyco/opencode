import { lazy } from "../../../opencode/src/util/lazy"

/**
 * Generate a cryptographically secure random secret.
 * Used for signing JWTs (device trust, 2FA tokens).
 */
function generateSecret(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(32))
}

/**
 * Server-wide signing secret for JWT tokens.
 * Generated once at server startup and kept in memory.
 *
 * Note: This means tokens are invalidated on server restart,
 * which is acceptable per design (sessions are also in-memory).
 */
const tokenSecret = lazy(() => generateSecret())

/**
 * Get the server's token signing secret.
 */
export function getTokenSecret(): Uint8Array {
  return tokenSecret()
}
