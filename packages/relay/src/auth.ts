import { TUNNEL_TOKEN_TTL_MS, CLIENT_TOKEN_TTL_MS } from "./protocol"

export type TunnelClaims = {
  kind: "tunnel"
  pairId: string
  iat: number
  exp: number
}

export type ClientClaims = {
  kind: "client"
  pairId: string
  iat: number
  exp: number
}

export type AnyClaims = TunnelClaims | ClientClaims

function b64urlEncode(bytes: Uint8Array): string {
  let bin = ""
  for (const byte of bytes) bin += String.fromCharCode(byte)
  return btoa(bin).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "")
}

function b64urlDecode(str: string): Uint8Array {
  const padded = str.replaceAll("-", "+").replaceAll("_", "/") + "=".repeat((4 - (str.length % 4)) % 4)
  const bin = atob(padded)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

async function hmac(secret: string, message: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  )
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message))
  return new Uint8Array(sig)
}

function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= (a[i] ?? 0) ^ (b[i] ?? 0)
  return diff === 0
}

export async function mintToken(secret: string, claims: Omit<AnyClaims, "iat" | "exp">): Promise<string> {
  const now = Date.now()
  const ttl = claims.kind === "tunnel" ? TUNNEL_TOKEN_TTL_MS : CLIENT_TOKEN_TTL_MS
  const full: AnyClaims = { ...claims, iat: now, exp: now + ttl }
  const payload = b64urlEncode(new TextEncoder().encode(JSON.stringify(full)))
  const sig = b64urlEncode(await hmac(secret, payload))
  return `${payload}.${sig}`
}

export async function verifyToken(secret: string, token: string): Promise<AnyClaims | null> {
  const dot = token.indexOf(".")
  if (dot < 0) return null
  const payload = token.slice(0, dot)
  const sig = token.slice(dot + 1)
  const expected = await hmac(secret, payload)
  let provided: Uint8Array
  try {
    provided = b64urlDecode(sig)
  } catch {
    return null
  }
  if (!timingSafeEqual(expected, provided)) return null
  let claims: AnyClaims
  try {
    claims = JSON.parse(new TextDecoder().decode(b64urlDecode(payload))) as AnyClaims
  } catch {
    return null
  }
  if (claims.exp < Date.now()) return null
  return claims
}

export function readBearer(headerValue: string | undefined | null): string | null {
  if (!headerValue) return null
  const match = /^Bearer\s+(.+)$/i.exec(headerValue)
  return match ? match[1]!.trim() : null
}
