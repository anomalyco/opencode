import crypto from "crypto"

function base64UrlEncode(buf: Buffer): string {
  return buf
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "")
}

export namespace PKCE {
  export function generateVerifier(byteLength: number = 32): string {
    return base64UrlEncode(crypto.randomBytes(byteLength))
  }

  export function challengeFromVerifier(verifier: string): string {
    const hash = crypto.createHash("sha256").update(verifier).digest()
    return base64UrlEncode(hash)
  }
}

export namespace OAuthState {
  export function generate(byteLength: number = 16): string {
    return base64UrlEncode(crypto.randomBytes(byteLength))
  }
}

