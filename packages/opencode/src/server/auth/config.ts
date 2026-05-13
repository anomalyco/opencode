import { Flag } from "@opencode-ai/core/flag/flag"
import type { ConfigServer } from "@/config/server"

export type Mode = "disabled" | "basic" | "oidc"

export type Basic = {
  username: string
  password: string
}

export type Oidc = {
  issuer: string
  clientID: string
  clientSecret?: string
  redirectURI?: string
  scopes: string[]
  audience?: string[]
  allowedEmails: string[]
  allowedDomains: string[]
  allowedGroups: string[]
  usernameClaim: string
  groupsClaim: string
  requireEmailVerified: boolean
}

export type Session = {
  secret?: string
  cookieName: string
  cookieSecure: boolean
  ttlSeconds: number
}

export type Info =
  | { mode: "disabled"; session: Session }
  | { mode: "basic"; basic: Basic; session: Session }
  | { mode: "oidc"; oidc: Oidc; session: Session }

export class InvalidAuthConfig extends Error {
  constructor(message: string) {
    super(message)
    this.name = "InvalidAuthConfig"
  }
}

function envList(key: string) {
  return process.env[key]
    ?.split(/[ ,]+/)
    .map((item) => item.trim())
    .filter((item) => item.length > 0)
}

function envBool(key: string) {
  const value = process.env[key]?.toLowerCase()
  if (value === "true" || value === "1") return true
  if (value === "false" || value === "0") return false
}

function envNumber(key: string) {
  const value = process.env[key]
  if (!value) return
  const parsed = Number(value)
  if (Number.isInteger(parsed) && parsed > 0) return parsed
}

function mode(config?: ConfigServer.Server["auth"]): Mode {
  if (process.env.OPENCODE_AUTH_MODE) {
    if (isMode(process.env.OPENCODE_AUTH_MODE)) return process.env.OPENCODE_AUTH_MODE
    throw new InvalidAuthConfig(`invalid OPENCODE_AUTH_MODE: ${process.env.OPENCODE_AUTH_MODE}`)
  }
  if (config?.mode) {
    if (isMode(config.mode)) return config.mode
    throw new InvalidAuthConfig(`invalid server.auth.mode: ${config.mode}`)
  }
  if (Flag.OPENCODE_SERVER_PASSWORD) return "basic"
  return "disabled"
}

function isMode(input: string): input is Mode {
  return input === "disabled" || input === "basic" || input === "oidc"
}

function session(config?: ConfigServer.Server["auth"]): Session {
  return {
    secret: process.env.OPENCODE_AUTH_SESSION_SECRET ?? config?.session?.secret,
    cookieName: process.env.OPENCODE_AUTH_COOKIE_NAME ?? config?.session?.cookieName ?? "opencode_auth",
    cookieSecure: envBool("OPENCODE_AUTH_COOKIE_SECURE") ?? config?.session?.cookieSecure ?? false,
    ttlSeconds: envNumber("OPENCODE_AUTH_SESSION_TTL_SECONDS") ?? config?.session?.ttlSeconds ?? 8 * 60 * 60,
  }
}

function basic(config?: ConfigServer.Server["auth"]): Basic {
  const password = process.env.OPENCODE_AUTH_BASIC_PASSWORD ?? config?.basic?.password ?? Flag.OPENCODE_SERVER_PASSWORD
  if (!password) throw new InvalidAuthConfig("server.auth.mode=basic requires a password")
  return {
    username:
      process.env.OPENCODE_AUTH_BASIC_USERNAME ??
      config?.basic?.username ??
      Flag.OPENCODE_SERVER_USERNAME ??
      "opencode",
    password,
  }
}

function oidc(config?: ConfigServer.Server["auth"]): Oidc {
  const issuer = process.env.OPENCODE_OIDC_ISSUER ?? config?.oidc?.issuer
  const clientID = process.env.OPENCODE_OIDC_CLIENT_ID ?? config?.oidc?.clientID
  if (!issuer) throw new InvalidAuthConfig("server.auth.mode=oidc requires an issuer")
  if (!clientID) throw new InvalidAuthConfig("server.auth.mode=oidc requires a client ID")
  return {
    issuer: issuer.replace(/\/$/, ""),
    clientID,
    clientSecret: process.env.OPENCODE_OIDC_CLIENT_SECRET ?? config?.oidc?.clientSecret,
    redirectURI: process.env.OPENCODE_OIDC_REDIRECT_URI ?? config?.oidc?.redirectURI,
    scopes: envList("OPENCODE_OIDC_SCOPES") ?? config?.oidc?.scopes ?? ["openid", "profile", "email"],
    audience: envList("OPENCODE_OIDC_AUDIENCE") ?? audience(config?.oidc?.audience),
    allowedEmails: envList("OPENCODE_OIDC_ALLOWED_EMAILS") ?? config?.oidc?.allowedEmails ?? [],
    allowedDomains: envList("OPENCODE_OIDC_ALLOWED_DOMAINS") ?? config?.oidc?.allowedDomains ?? [],
    allowedGroups: envList("OPENCODE_OIDC_ALLOWED_GROUPS") ?? config?.oidc?.allowedGroups ?? [],
    usernameClaim: process.env.OPENCODE_OIDC_USERNAME_CLAIM ?? config?.oidc?.usernameClaim ?? "preferred_username",
    groupsClaim: process.env.OPENCODE_OIDC_GROUPS_CLAIM ?? config?.oidc?.groupsClaim ?? "groups",
    requireEmailVerified:
      envBool("OPENCODE_OIDC_REQUIRE_EMAIL_VERIFIED") ?? config?.oidc?.requireEmailVerified ?? false,
  }
}

function audience(input: string | string[] | undefined) {
  if (!input) return
  return Array.isArray(input) ? input : [input]
}

export function resolve(config?: ConfigServer.Server["auth"]): Info {
  const selected = mode(config)
  const sessionConfig = session(config)
  if (selected === "disabled") return { mode: selected, session: sessionConfig }
  if (selected === "basic") return { mode: selected, basic: basic(config), session: sessionConfig }
  if (!sessionConfig.secret) throw new InvalidAuthConfig("server.auth.mode=oidc requires a session secret")
  if (sessionConfig.secret.length < 32) {
    throw new InvalidAuthConfig("server.auth.mode=oidc requires a session secret with at least 32 characters")
  }
  return { mode: selected, oidc: oidc(config), session: sessionConfig }
}

export * as ServerAuthConfig from "./config"
