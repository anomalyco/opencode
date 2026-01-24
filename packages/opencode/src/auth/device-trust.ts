import { SignJWT, jwtVerify, type JWTPayload } from "jose"

/**
 * Device trust token payload.
 */
interface DeviceTrustPayload extends JWTPayload {
  /** Username this device is trusted for */
  sub: string
  /** Device fingerprint (hash of user-agent) */
  dev: string
  /** Token version for global revocation */
  ver: number
}

/**
 * Create a device fingerprint from user-agent.
 * Simple hash to identify the device.
 */
export function createDeviceFingerprint(userAgent: string): string {
  // Use simple hash of user-agent
  const encoder = new TextEncoder()
  const data = encoder.encode(userAgent)
  // Use sync approach for simplicity - hash is short
  let hash = 0
  for (let i = 0; i < data.length; i++) {
    hash = ((hash << 5) - hash + data[i]) | 0
  }
  return Math.abs(hash).toString(36)
}

/**
 * Create a device trust token.
 *
 * @param username - User this device is trusted for
 * @param deviceFingerprint - Device identifier
 * @param durationSeconds - How long the trust lasts
 * @param secret - Signing secret (should be from config or generated at startup)
 */
export async function createDeviceTrustToken(
  username: string,
  deviceFingerprint: string,
  durationSeconds: number,
  secret: Uint8Array,
): Promise<string> {
  const now = Math.floor(Date.now() / 1000)

  return new SignJWT({
    sub: username,
    dev: deviceFingerprint,
    ver: 1,
  } as DeviceTrustPayload)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt(now)
    .setExpirationTime(now + durationSeconds)
    .sign(secret)
}

/**
 * Verify a device trust token.
 *
 * @param token - The JWT token to verify
 * @param expectedFingerprint - Expected device fingerprint
 * @param secret - Signing secret
 * @returns Username if valid, null if invalid
 */
export async function verifyDeviceTrustToken(
  token: string,
  expectedFingerprint: string,
  secret: Uint8Array,
): Promise<string | null> {
  try {
    const { payload } = await jwtVerify(token, secret)
    const trustPayload = payload as DeviceTrustPayload

    // Verify device fingerprint matches
    if (trustPayload.dev !== expectedFingerprint) {
      return null
    }

    return trustPayload.sub ?? null
  } catch {
    return null
  }
}
