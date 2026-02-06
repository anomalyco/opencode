import { createHmac, randomBytes, timingSafeEqual } from "node:crypto"
import { Log } from "../../../opencode/src/util/log"

const log = Log.create({ service: "csrf" })

/**
 * CSRF cookie name used for double-submit pattern.
 */
export const CSRF_COOKIE_NAME = "opencode_csrf"

/**
 * CSRF header name expected in state-changing requests.
 */
export const CSRF_HEADER_NAME = "X-CSRF-Token"

// Cache for auto-generated CSRF secret
let cachedSecret: string | undefined

/**
 * Get CSRF secret from environment or generate one.
 *
 * In production, set OPENCODE_CSRF_SECRET environment variable.
 * For development, a random secret is generated and cached.
 */
export function getCSRFSecret(): string {
  // Use environment variable if set
  const envSecret = process.env.OPENCODE_CSRF_SECRET
  if (envSecret) {
    return envSecret
  }

  // Generate and cache random secret for development
  if (!cachedSecret) {
    cachedSecret = randomBytes(32).toString("hex")
    log.warn("Using auto-generated CSRF secret. Set OPENCODE_CSRF_SECRET in production.")
  }

  return cachedSecret
}

/**
 * Generate CSRF token using HMAC-signed double-submit pattern.
 *
 * Token format: `{signature}.{randomValue}`
 * - signature: HMAC-SHA256(sessionId:randomValue, secret)
 * - randomValue: 32 bytes of random data
 *
 * The session binding via HMAC prevents token fixation attacks where an
 * attacker tries to use their own token on a victim's session.
 *
 * @param sessionId - Session ID to bind token to
 * @param secret - HMAC secret key
 * @returns Token in format `{signature}.{randomValue}` (hex-encoded)
 */
export function generateCSRFToken(sessionId: string, secret: string): string {
  // Generate random value
  const randomValue = randomBytes(32).toString("hex")

  // Create HMAC signature binding sessionId to randomValue
  const hmac = createHmac("sha256", secret)
  hmac.update(`${sessionId}:${randomValue}`)
  const signature = hmac.digest("hex")

  return `${signature}.${randomValue}`
}

/**
 * Validate CSRF token using constant-time comparison.
 *
 * Verifies both format and HMAC signature binding to sessionId.
 *
 * @param token - Token from cookie or header
 * @param sessionId - Current session ID
 * @param secret - HMAC secret key
 * @returns True if token is valid and bound to session
 */
export function validateCSRFToken(token: string, sessionId: string, secret: string): boolean {
  try {
    // Split token into parts
    const parts = token.split(".")
    if (parts.length !== 2) {
      return false
    }

    const [signature, randomValue] = parts
    if (!signature || !randomValue) {
      return false
    }

    // Recompute expected HMAC
    const hmac = createHmac("sha256", secret)
    hmac.update(`${sessionId}:${randomValue}`)
    const expectedSignature = hmac.digest("hex")

    // Convert to buffers for constant-time comparison
    const signatureBuffer = Buffer.from(signature, "hex")
    const expectedBuffer = Buffer.from(expectedSignature, "hex")

    // Check lengths match (timingSafeEqual throws if not)
    if (signatureBuffer.length !== expectedBuffer.length) {
      return false
    }

    // Constant-time comparison
    return timingSafeEqual(signatureBuffer, expectedBuffer)
  } catch {
    // Any error in validation is a failure
    return false
  }
}
