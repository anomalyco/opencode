import { createHash, randomBytes, timingSafeEqual } from "crypto"

export namespace Crypto {
  /** Constant-time string comparison to prevent timing attacks */
  export function timingSafeCompare(a: string, b: string): boolean {
    if (a.length !== b.length) {
      // Compare against self to maintain constant time even on length mismatch
      const buf = Buffer.from(a)
      timingSafeEqual(buf, buf)
      return false
    }
    return timingSafeEqual(Buffer.from(a), Buffer.from(b))
  }

  /** Generate PKCE code verifier (43-128 chars, URL-safe) */
  export function generateCodeVerifier(length = 64): string {
    return randomBytes(length).toString("base64url").slice(0, length)
  }

  /** Generate PKCE code challenge (SHA256 of verifier, base64url encoded) */
  export function generateCodeChallenge(verifier: string): string {
    return createHash("sha256").update(verifier).digest("base64url")
  }
}
