import crypto from "node:crypto"

export function generateCodeVerifier(): string {
  return crypto.randomBytes(32).toString("base64url")
}

export function generateCodeChallenge(codeVerifier: string): string {
  const hash = crypto.createHash("sha256").update(codeVerifier).digest()
  return hash.toString("base64url")
}

export function generateState(): string {
  return crypto.randomBytes(16).toString("base64url")
}
