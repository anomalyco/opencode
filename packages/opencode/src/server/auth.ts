export * as ServerAuth from "./auth"

import { Flag } from "@opencode-ai/core/flag/flag"
import type { ConfigServer } from "@/config/server"
import { createRemoteJWKSet, jwtVerify } from "jose"
import { Context, Effect, Layer, Option, Redacted } from "effect"
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/unstable/http"
import { createHmac, randomBytes } from "node:crypto"

export type Mode = "disabled" | "basic" | "oidc"

export type Credentials = {
  password?: string
  username?: string
  authToken?: string
}

export type DecodedCredentials = {
  readonly username: string
  readonly password: Redacted.Redacted
}

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

export type Info = {
  mode: Mode
  basic?: Basic
  oidc?: Oidc
  session: Session
  password: Option.Option<string>
  username: string
}

export type Identity = {
  type: "oidc"
  issuer: string
  subject: string
  email?: string
  name?: string
  groups?: string[]
  expires: number
}

export class Config extends Context.Service<Config, Info>()("@opencode/ServerAuthConfig") {
  static layer(input: Partial<Info> & { password?: Option.Option<string>; username?: string }) {
    return Layer.succeed(this, this.of(normalize(input)))
  }

  static get defaultLayer() {
    return Layer.effect(
      this,
      Effect.sync(() => this.of(fromConfig())),
    )
  }
}

export class InvalidConfig extends Error {}

export class Unauthorized extends Error {}

const temporaryCookieName = "opencode_oidc_tmp"
const discoveryCache = new Map<
  string,
  Promise<{ authorization_endpoint: string; token_endpoint: string; jwks_uri: string }>
>()
const jwksCache = new Map<string, ReturnType<typeof createRemoteJWKSet>>()

export function normalize(input: Partial<Info> & { password?: Option.Option<string>; username?: string }): Info {
  if (input.mode) return input as Info
  const password = input.password ?? Option.none<string>()
  const username = input.username ?? "opencode"
  return {
    mode: Option.isSome(password) && password.value !== "" ? "basic" : "disabled",
    basic: Option.isSome(password) && password.value !== "" ? { username, password: password.value } : undefined,
    session: { cookieName: "opencode_auth", cookieSecure: false, ttlSeconds: 8 * 60 * 60 },
    password,
    username,
  }
}

export function fromConfig(config?: ConfigServer.Server["auth"]): Info {
  const mode = authMode(config)
  const session = sessionConfig(config)
  if (mode === "disabled") {
    return { mode, session, password: Option.none(), username: basicUsername(config) }
  }
  if (mode === "basic") {
    const password =
      process.env.OPENCODE_AUTH_BASIC_PASSWORD ?? config?.basic?.password ?? Flag.OPENCODE_SERVER_PASSWORD
    if (!password) throw new InvalidConfig("server.auth.mode=basic requires a password")
    const basic = { username: basicUsername(config), password }
    return { mode, basic, session, password: Option.some(password), username: basic.username }
  }
  if (!session.secret) throw new InvalidConfig("server.auth.mode=oidc requires a session secret")
  if (session.secret.length < 32)
    throw new InvalidConfig("server.auth.mode=oidc requires a session secret with at least 32 characters")
  return { mode, oidc: oidcConfig(config), session, password: Option.none(), username: basicUsername(config) }
}

export function required(config: Info | (Partial<Info> & { password?: Option.Option<string>; username?: string })) {
  return normalize(config).mode !== "disabled"
}

export function authorized(
  credentials: DecodedCredentials,
  config: Info | (Partial<Info> & { password?: Option.Option<string>; username?: string }),
) {
  const resolved = normalize(config)
  return (
    resolved.mode === "basic" &&
    resolved.basic !== undefined &&
    credentials.username === resolved.basic.username &&
    Redacted.value(credentials.password) === resolved.basic.password
  )
}

export function header(credentials?: Credentials) {
  const authToken = credentials?.authToken ?? process.env.OPENCODE_AUTH_TOKEN
  if (authToken) return `Bearer ${authToken}`
  const password = credentials?.password ?? Flag.OPENCODE_SERVER_PASSWORD
  if (!password) return undefined
  const username = credentials?.username ?? Flag.OPENCODE_SERVER_USERNAME ?? "opencode"
  return `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`
}

export function headers(credentials?: Credentials) {
  const authorization = header(credentials)
  if (!authorization) return undefined
  return { Authorization: authorization }
}

export function decodeBasic(input: string) {
  try {
    const parts = Buffer.from(input, "base64").toString().split(":")
    if (parts.length !== 2) return undefined
    return { username: parts[0], password: Redacted.make(parts[1]) }
  } catch {
    return undefined
  }
}

export async function verifyRequest(config: Info, request: Request) {
  if (config.mode === "disabled") return
  if (config.mode === "basic") {
    const url = new URL(request.url)
    const token = url.searchParams.get("auth_token")
    const match = /^Basic\s+(.+)$/i.exec(request.headers.get("authorization") ?? "")
    const credential = token ? decodeBasic(token) : match ? decodeBasic(match[1]) : undefined
    if (credential && authorized(credential, config)) return
    throw new Unauthorized("Unauthorized")
  }
  const bearer = /^Bearer\s+(.+)$/i.exec(request.headers.get("authorization") ?? "")?.[1]
  if (bearer) {
    await verifyToken(config.oidc!, bearer)
    return
  }
  const identity = parseSession(
    config.session,
    readCookie(request.headers.get("cookie") ?? undefined, config.session.cookieName),
  )
  if (identity && identity.issuer === config.oidc!.issuer && identity.expires > Math.floor(Date.now() / 1000)) return
  throw new Unauthorized("Unauthorized")
}

export function wantsHtml(request: HttpServerRequest.HttpServerRequest) {
  return request.method === "GET" && (request.headers.accept ?? "").includes("text/html")
}

export function requestFromEffect(request: HttpServerRequest.HttpServerRequest) {
  return new Request(new URL(request.url, "http://localhost"), { method: request.method, headers: request.headers })
}

export const routes = HttpRouter.use((router) =>
  Effect.gen(function* () {
    const config = yield* Config
    yield* router.add("GET", "/auth/login", (request) => Effect.promise(() => login(config, request)))
    yield* router.add("GET", "/auth/callback", (request) => Effect.promise(() => callback(config, request)))
    yield* router.add("POST", "/auth/logout", () => Effect.succeed(logout(config)))
    yield* router.add("GET", "/auth/me", (request) => Effect.promise(() => me(config, request)))
  }),
)

function authMode(config?: ConfigServer.Server["auth"]): Mode {
  if (process.env.OPENCODE_AUTH_MODE) {
    if (isMode(process.env.OPENCODE_AUTH_MODE)) return process.env.OPENCODE_AUTH_MODE
    throw new InvalidConfig(`invalid OPENCODE_AUTH_MODE: ${process.env.OPENCODE_AUTH_MODE}`)
  }
  if (config?.mode) return config.mode
  if (Flag.OPENCODE_SERVER_PASSWORD) return "basic"
  return "disabled"
}

function isMode(input: string): input is Mode {
  return input === "disabled" || input === "basic" || input === "oidc"
}

function basicUsername(config?: ConfigServer.Server["auth"]) {
  return (
    process.env.OPENCODE_AUTH_BASIC_USERNAME ?? config?.basic?.username ?? Flag.OPENCODE_SERVER_USERNAME ?? "opencode"
  )
}

function sessionConfig(config?: ConfigServer.Server["auth"]): Session {
  return {
    secret: process.env.OPENCODE_AUTH_SESSION_SECRET ?? config?.session?.secret,
    cookieName: process.env.OPENCODE_AUTH_COOKIE_NAME ?? config?.session?.cookieName ?? "opencode_auth",
    cookieSecure: envBool("OPENCODE_AUTH_COOKIE_SECURE") ?? config?.session?.cookieSecure ?? false,
    ttlSeconds: envNumber("OPENCODE_AUTH_SESSION_TTL_SECONDS") ?? config?.session?.ttlSeconds ?? 8 * 60 * 60,
  }
}

function oidcConfig(config?: ConfigServer.Server["auth"]): Oidc {
  const issuer = process.env.OPENCODE_OIDC_ISSUER ?? config?.oidc?.issuer
  const clientID = process.env.OPENCODE_OIDC_CLIENT_ID ?? config?.oidc?.clientID
  if (!issuer) throw new InvalidConfig("server.auth.mode=oidc requires an issuer")
  if (!clientID) throw new InvalidConfig("server.auth.mode=oidc requires a client ID")
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

function envList(name: string) {
  return process.env[name]
    ?.split(",")
    .map((x) => x.trim())
    .filter(Boolean)
}

function envBool(name: string) {
  if (process.env[name] === undefined) return
  return process.env[name] === "true" || process.env[name] === "1"
}

function envNumber(name: string) {
  if (!process.env[name]) return
  const parsed = Number(process.env[name])
  if (Number.isInteger(parsed) && parsed > 0) return parsed
}

function audience(input: string | string[] | undefined) {
  if (!input) return
  return Array.isArray(input) ? input : [input]
}

async function metadata(config: Oidc) {
  const cached = discoveryCache.get(config.issuer)
  if (cached) return cached
  const promise = fetch(`${config.issuer}/.well-known/openid-configuration`).then(async (response) => {
    if (!response.ok) throw new Unauthorized("OIDC discovery failed")
    const json = (await response.json()) as Record<string, unknown>
    if (
      typeof json.authorization_endpoint !== "string" ||
      typeof json.token_endpoint !== "string" ||
      typeof json.jwks_uri !== "string"
    ) {
      throw new Unauthorized("OIDC discovery metadata is incomplete")
    }
    return {
      authorization_endpoint: json.authorization_endpoint,
      token_endpoint: json.token_endpoint,
      jwks_uri: json.jwks_uri,
    }
  })
  discoveryCache.set(config.issuer, promise)
  return promise
}

async function verifyToken(config: Oidc, token: string, nonce?: string) {
  const meta = await metadata(config)
  const jwks = jwksCache.get(meta.jwks_uri) ?? createRemoteJWKSet(new URL(meta.jwks_uri))
  jwksCache.set(meta.jwks_uri, jwks)
  const result = await jwtVerify(token, jwks, {
    issuer: config.issuer,
    audience: config.audience?.length ? config.audience : [config.clientID],
    clockTolerance: "30s",
  })
  if (nonce && result.payload.nonce !== nonce) throw new Unauthorized("Invalid OIDC nonce")
  authorizeClaims(config, result.payload)
  return result.payload
}

function authorizeClaims(config: Oidc, claims: Record<string, unknown>) {
  if (config.requireEmailVerified && claims.email_verified !== true) throw new Unauthorized("Email is not verified")
  const email = typeof claims.email === "string" ? claims.email : undefined
  const claimGroups = claims[config.groupsClaim]
  const groups = Array.isArray(claimGroups) ? claimGroups.filter((x): x is string => typeof x === "string") : []
  const hasPolicy = config.allowedEmails.length || config.allowedDomains.length || config.allowedGroups.length
  if (!hasPolicy) return
  if (email && config.allowedEmails.includes(email)) return
  if (email && config.allowedDomains.some((domain) => email.endsWith(`@${domain}`))) return
  if (groups.some((group) => config.allowedGroups.includes(group))) return
  throw new Unauthorized("OIDC identity is not allowed")
}

async function login(config: Info, request: HttpServerRequest.HttpServerRequest) {
  if (config.mode !== "oidc")
    return HttpServerResponse.jsonUnsafe({ error: "OIDC auth is not enabled" }, { status: 404 })
  const url = new URL(request.url, "http://localhost")
  const redirectURI = config.oidc!.redirectURI ?? new URL("/auth/callback", url.origin).toString()
  const state = token()
  const nonce = token()
  const verifier = token()
  const challenge = await sha256(verifier)
  const meta = await metadata(config.oidc!)
  const target = new URL(meta.authorization_endpoint)
  target.searchParams.set("response_type", "code")
  target.searchParams.set("client_id", config.oidc!.clientID)
  target.searchParams.set("redirect_uri", redirectURI)
  target.searchParams.set("scope", config.oidc!.scopes.join(" "))
  target.searchParams.set("state", state)
  target.searchParams.set("nonce", nonce)
  target.searchParams.set("code_challenge", challenge)
  target.searchParams.set("code_challenge_method", "S256")
  const headers = new Headers({ location: target.toString() })
  headers.append(
    "set-cookie",
    temporaryCookie(
      config.session,
      temporaryCookieName,
      encodeURIComponent(
        JSON.stringify({ state, nonce, verifier, returnTo: safeReturnTo(url.searchParams.get("return_to")) }),
      ),
    ),
  )
  return HttpServerResponse.empty({ status: 302, headers })
}

async function callback(config: Info, request: HttpServerRequest.HttpServerRequest) {
  if (config.mode !== "oidc")
    return HttpServerResponse.jsonUnsafe({ error: "OIDC auth is not enabled" }, { status: 404 })
  const url = new URL(request.url, "http://localhost")
  const cookies = request.headers.cookie
  const temporary = readTemporary(cookies)
  const state = temporary?.state
  const nonce = temporary?.nonce
  const verifier = temporary?.verifier
  const headers = clearTemporary(config.session)
  if (!state || !nonce || !verifier || url.searchParams.get("state") !== state) {
    return HttpServerResponse.jsonUnsafe({ error: "Invalid OIDC state" }, { status: 401, headers })
  }
  const code = url.searchParams.get("code")
  if (!code) return HttpServerResponse.jsonUnsafe({ error: "Missing OIDC code" }, { status: 400, headers })
  const redirectURI = config.oidc!.redirectURI ?? new URL("/auth/callback", url.origin).toString()
  const params = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectURI,
    client_id: config.oidc!.clientID,
    code_verifier: verifier,
  })
  if (config.oidc!.clientSecret) params.set("client_secret", config.oidc!.clientSecret)
  const response = await fetch((await metadata(config.oidc!)).token_endpoint, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: params,
  })
  if (!response.ok)
    return HttpServerResponse.jsonUnsafe({ error: "OIDC authentication failed" }, { status: 401, headers })
  const body = (await response.json()) as Record<string, unknown>
  if (typeof body.id_token !== "string")
    return HttpServerResponse.jsonUnsafe({ error: "OIDC authentication failed" }, { status: 401, headers })
  const claims = await verifyToken(config.oidc!, body.id_token, nonce).catch(() => undefined)
  if (!claims) return HttpServerResponse.jsonUnsafe({ error: "OIDC authentication failed" }, { status: 401, headers })
  headers.set("location", safeReturnTo(temporary?.returnTo))
  headers.append(
    "set-cookie",
    sessionCookie(
      config.session,
      serialize(config.session, {
        type: "oidc",
        issuer: config.oidc!.issuer,
        subject: String(claims.sub),
        email: typeof claims.email === "string" ? claims.email : undefined,
        name: typeof claims.name === "string" ? claims.name : undefined,
        groups: groupsFromClaims(claims, config.oidc!.groupsClaim),
      }),
    ),
  )
  return HttpServerResponse.empty({ status: 302, headers })
}

function groupsFromClaims(claims: Record<string, unknown>, claim: string) {
  const groups = claims[claim]
  return Array.isArray(groups) ? groups.filter((x): x is string => typeof x === "string") : []
}

function logout(config: Info) {
  const headers = new Headers()
  headers.append("set-cookie", clearCookie(config.session))
  return HttpServerResponse.jsonUnsafe(true, { headers })
}

async function me(config: Info, request: HttpServerRequest.HttpServerRequest) {
  try {
    await verifyRequest(config, requestFromEffect(request))
    return HttpServerResponse.jsonUnsafe({ authenticated: true, mode: config.mode })
  } catch {
    return HttpServerResponse.jsonUnsafe({ error: "Unauthorized" }, { status: 401 })
  }
}

function token() {
  return randomBytes(32).toString("base64url")
}

async function sha256(input: string) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input))
  return Buffer.from(bytes).toString("base64url")
}

function serialize(config: Session, identity: Omit<Identity, "expires">) {
  const value = JSON.stringify({ ...identity, expires: Math.floor(Date.now() / 1000) + config.ttlSeconds })
  const payload = Buffer.from(value).toString("base64url")
  return `${payload}.${sign(config, payload)}`
}

function parseSession(config: Session, input: string | undefined) {
  if (!input) return
  const [payload, signature] = input.split(".")
  if (!payload || !signature || sign(config, payload) !== signature) return
  return JSON.parse(Buffer.from(payload, "base64url").toString()) as Identity
}

function sign(config: Session, payload: string) {
  return createHmac("sha256", config.secret ?? "")
    .update(payload)
    .digest("base64url")
}

function sessionCookie(config: Session, value: string) {
  return cookie(config, config.cookieName, value, config.ttlSeconds, "/")
}

function temporaryCookie(config: Session, name: string, value: string) {
  return cookie(config, name, value, 600, "/auth")
}

function clearCookie(config: Session, name = config.cookieName) {
  return cookie(config, name, "", 0, name === config.cookieName ? "/" : "/auth")
}

function cookie(config: Session, name: string, value: string, maxAge: number, path: string) {
  return [
    `${name}=${value}`,
    `Max-Age=${maxAge}`,
    `Path=${path}`,
    "HttpOnly",
    "SameSite=Lax",
    config.cookieSecure ? "Secure" : undefined,
  ]
    .filter(Boolean)
    .join("; ")
}

function clearTemporary(config: Session) {
  const headers = new Headers()
  headers.append("set-cookie", clearCookie(config, temporaryCookieName))
  return headers
}

function readTemporary(cookie: string | undefined) {
  try {
    const value = readCookie(cookie, temporaryCookieName)
    if (!value) return
    const parsed = JSON.parse(decodeURIComponent(value)) as Record<string, unknown>
    if (
      typeof parsed.state !== "string" ||
      typeof parsed.nonce !== "string" ||
      typeof parsed.verifier !== "string" ||
      typeof parsed.returnTo !== "string"
    ) {
      return
    }
    return { state: parsed.state, nonce: parsed.nonce, verifier: parsed.verifier, returnTo: parsed.returnTo }
  } catch {
    return
  }
}

function readCookie(cookie: string | undefined, name: string) {
  return cookie
    ?.split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name}=`))
    ?.slice(name.length + 1)
}

function safeReturnTo(input: string | null | undefined) {
  if (!input || !input.startsWith("/") || input.startsWith("//")) return "/"
  return input
}
