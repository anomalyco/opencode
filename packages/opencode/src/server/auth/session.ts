import { createHmac, timingSafeEqual } from "node:crypto"
import type { ServerAuthConfig } from "./config"

export type Identity = {
  type: "oidc"
  issuer: string
  subject: string
  email?: string
  name?: string
  groups?: string[]
  expires: number
}

function base64url(input: Buffer | string) {
  return (typeof input === "string" ? Buffer.from(input) : input).toString("base64url")
}

function sign(secret: string, value: string) {
  return createHmac("sha256", secret).update(value).digest("base64url")
}

export function serialize(config: ServerAuthConfig.Session, identity: Omit<Identity, "expires">) {
  if (!config.secret) throw new Error("missing auth session secret")
  const payload = base64url(JSON.stringify({ ...identity, expires: Math.floor(Date.now() / 1000) + config.ttlSeconds }))
  return `${payload}.${sign(config.secret, payload)}`
}

export function parse(config: ServerAuthConfig.Session, input?: string | null) {
  if (!config.secret || !input) return
  const [payload, signature] = input.split(".")
  if (!payload || !signature) return
  const expected = sign(config.secret, payload)
  if (
    signature.length !== expected.length ||
    !timingSafeEqual(Buffer.from(signature, "base64url"), Buffer.from(expected, "base64url"))
  ) {
    return
  }
  const identity = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Identity
  if (identity.expires <= Math.floor(Date.now() / 1000)) return
  return identity
}

export function cookie(config: ServerAuthConfig.Session, value: string, maxAge = config.ttlSeconds) {
  return `${config.cookieName}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${config.cookieSecure ? "; Secure" : ""}`
}

export function clearCookie(config: ServerAuthConfig.Session, name = config.cookieName) {
  return `${name}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${config.cookieSecure ? "; Secure" : ""}`
}

export function temporaryCookie(config: ServerAuthConfig.Session, name: string, value: string, maxAge = 300) {
  return `${name}=${value}; Path=/auth; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${config.cookieSecure ? "; Secure" : ""}`
}

export function readCookie(header: string | null | undefined, name: string) {
  return header
    ?.split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name}=`))
    ?.slice(name.length + 1)
}

export * as ServerAuthSession from "./session"
