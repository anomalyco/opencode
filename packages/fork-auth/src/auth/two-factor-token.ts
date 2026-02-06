import { SignJWT, jwtVerify, type JWTPayload } from "jose"

/**
 * 2FA token payload - issued after password success, consumed by OTP validation.
 * Contains user info needed to create session after successful 2FA.
 */
interface TwoFactorTokenPayload extends JWTPayload {
  /** Username */
  sub: string
  /** UNIX user ID */
  uid: number
  /** UNIX group ID */
  gid: number
  /** Home directory */
  home: string
  /** Login shell */
  shell: string
  /** IP address of requester (for binding) */
  ip?: string
}

/**
 * User info needed for session creation after 2FA.
 */
export interface TwoFactorUserInfo {
  username: string
  uid: number
  gid: number
  home: string
  shell: string
}

/**
 * Create a short-lived 2FA token after password validation.
 *
 * @param userInfo - User info from password auth
 * @param timeoutSeconds - Token validity (default 5 minutes = 300 seconds)
 * @param secret - Signing secret
 * @param ip - Optional IP address for binding
 */
export async function create2FAToken(
  userInfo: TwoFactorUserInfo,
  timeoutSeconds: number,
  secret: Uint8Array,
  ip?: string,
): Promise<string> {
  const now = Math.floor(Date.now() / 1000)

  return new SignJWT({
    sub: userInfo.username,
    uid: userInfo.uid,
    gid: userInfo.gid,
    home: userInfo.home,
    shell: userInfo.shell,
    ip,
  } as TwoFactorTokenPayload)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt(now)
    .setExpirationTime(now + timeoutSeconds)
    .sign(secret)
}

/**
 * Verify a 2FA token and extract user info.
 *
 * @param token - The JWT token to verify
 * @param secret - Signing secret
 * @param expectedIp - Optional IP to verify against
 * @returns User info if valid, null if invalid/expired
 */
export async function verify2FAToken(
  token: string,
  secret: Uint8Array,
  expectedIp?: string,
): Promise<TwoFactorUserInfo | null> {
  try {
    const { payload } = await jwtVerify(token, secret)
    const tfaPayload = payload as TwoFactorTokenPayload

    // If IP binding is expected, verify it matches
    if (expectedIp && tfaPayload.ip && tfaPayload.ip !== expectedIp) {
      return null
    }

    // Validate required fields
    if (
      !tfaPayload.sub ||
      tfaPayload.uid === undefined ||
      tfaPayload.gid === undefined ||
      !tfaPayload.home ||
      !tfaPayload.shell
    ) {
      return null
    }

    return {
      username: tfaPayload.sub,
      uid: tfaPayload.uid,
      gid: tfaPayload.gid,
      home: tfaPayload.home,
      shell: tfaPayload.shell,
    }
  } catch {
    return null
  }
}

/**
 * Calculate remaining seconds until token expiration.
 * Returns 0 if token is invalid or expired.
 */
export function getTokenRemainingSeconds(token: string): number {
  try {
    // Decode without verification to get exp claim
    const [, payloadBase64] = token.split(".")
    if (!payloadBase64) return 0

    const payload = JSON.parse(atob(payloadBase64.replace(/-/g, "+").replace(/_/g, "/")))
    const exp = payload.exp as number | undefined
    if (!exp) return 0

    const now = Math.floor(Date.now() / 1000)
    const remaining = exp - now
    return remaining > 0 ? remaining : 0
  } catch {
    return 0
  }
}
