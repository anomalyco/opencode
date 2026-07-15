export * as ServerAuth from "./auth"

import { ConfigService } from "@/effect/config-service"
import { Flag } from "@opencode-ai/core/flag/flag"
import { Config as EffectConfig, Context, Option, Redacted } from "effect"
import crypto from "node:crypto"
import { isIPv4, isIPv6 } from "node:net"

// Constant-time string comparison. Guards the server-password check against a
// timing oracle. The length check leaks length only (standard trade-off);
// timingSafeEqual requires equal-length buffers.
function timingSafeStringEqual(a: string, b: string) {
  const ab = Buffer.from(a, "utf8")
  const bb = Buffer.from(b, "utf8")
  if (ab.length !== bb.length) return false
  return crypto.timingSafeEqual(ab, bb)
}

export type Credentials = {
  password?: string
  username?: string
}

export type DecodedCredentials = {
  readonly username: string
  readonly password: Redacted.Redacted
}

export class Config extends ConfigService.Service<Config>()("@opencode/ServerAuthConfig", {
  password: EffectConfig.string("OPENCODE_SERVER_PASSWORD").pipe(EffectConfig.option),
  username: EffectConfig.string("OPENCODE_SERVER_USERNAME").pipe(EffectConfig.withDefault("opencode")),
}) {}

export type Info = Context.Service.Shape<typeof Config>

export function required(config: Info) {
  return Option.isSome(config.password) && config.password.value !== ""
}

export function isLoopbackHostname(hostname: string) {
  if (hostname === "localhost") return true
  if (isIPv4(hostname)) return hostname.split(".")[0] === "127"
  if (!isIPv6(hostname)) return false
  return hostname === "::1" || hostname === "0:0:0:0:0:0:0:1"
}

export function requiresPasswordForBind(opts: { hostname: string; mdns?: boolean }) {
  return opts.mdns === true || !isLoopbackHostname(opts.hostname)
}

export function assertAuthenticatedBind(opts: { hostname: string; mdns?: boolean }) {
  if (process.env.AIXPLAIN_CODE_SERVER_PASSWORD || !requiresPasswordForBind(opts)) return
  throw new Error(
    `Refusing to bind ${opts.hostname}${opts.mdns ? " (mDNS)" : ""} without authentication. ` +
      "Set AIXPLAIN_CODE_SERVER_PASSWORD to expose the server on the network, or bind 127.0.0.1 for local-only access.",
  )
}

export function authorized(credentials: DecodedCredentials, config: Info) {
  if (Option.isNone(config.password)) return false
  // Evaluate both comparisons (no short-circuit on the first) so the check does
  // not reveal, via timing, whether the username was correct.
  const usernameOk = timingSafeStringEqual(credentials.username, config.username)
  const passwordOk = timingSafeStringEqual(Redacted.value(credentials.password), config.password.value)
  return usernameOk && passwordOk
}

export function header(credentials?: Credentials) {
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
