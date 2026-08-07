export * as ServerAuth from "./auth"

import { UserContext } from "@opencode-ai/schema/user-context"
import { Config as EffectConfig, Context, Effect, Layer, Option, Redacted } from "effect"

export type Credentials = {
  password?: string
  username?: string
}

export type DecodedCredentials = {
  readonly username: string
  readonly password: Redacted.Redacted
}

export type Info = {
  readonly password: Option.Option<string>
  readonly username: string
}

export class Config extends Context.Service<Config, Info>()("@opencode/ServerAuthConfig") {
  static configLayer(input: Info) {
    return Layer.succeed(this, this.of(input))
  }

  static get layer() {
    return Layer.effect(
      this,
      Effect.gen(function* () {
        return Config.of(
          yield* EffectConfig.all({
            password: EffectConfig.string("OPENCODE_SERVER_PASSWORD").pipe(EffectConfig.option),
            username: EffectConfig.string("OPENCODE_SERVER_USERNAME").pipe(EffectConfig.withDefault("opencode")),
          }),
        )
      }),
    )
  }
}

// ─── JWT Config ─────────────────────────────────────────────────

export class JwtConfig extends Context.Service<JwtConfig, string>()("@opencode/JwtConfig") {
  static get layer() {
    return Layer.effect(
      this,
      EffectConfig.string("OPENCODE_JWT_SECRET").pipe(
        EffectConfig.withDefault(""),
        Effect.map((secret) => JwtConfig.of(secret)),
      ),
    )
  }
}

// ─── JWT Validation ──────────────────────────────────────────────

function base64UrlDecode(input: string): Uint8Array {
  const base64 = input.replace(/-/g, "+").replace(/_/g, "/").padEnd(input.length + ((4 - (input.length % 4)) % 4), "=")
  return Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))
}

function base64UrlEncode(data: Uint8Array): string {
  return btoa(String.fromCodePoint(...data)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
}

function textEncoder() {
  return new TextEncoder()
}

function decodeJwtPayload(payload: string): { info: UserContext.Info; exp?: number } {
  const parsed = JSON.parse(new TextDecoder().decode(base64UrlDecode(payload)))
  return {
    info: {
      userID: parsed.user_id ?? parsed.userId ?? parsed.sub ?? "",
      username: parsed.username ?? parsed.preferred_username ?? "",
      departmentCode: parsed.department_code ?? parsed.departmentCode ?? parsed.dept_code ?? undefined,
      role: parsed.role ?? "user",
      permissions: parsed.permissions ?? [],
    },
    exp: parsed.exp,
  }
}

export const validateJwt = Effect.fn("ServerAuth.validateJwt")(function* (token: string) {
  const secret = yield* JwtConfig
  if (!secret) return Option.none<UserContext.Info>()

  const parts = token.split(".")
  if (parts.length !== 3) return Option.none<UserContext.Info>()

  const [headerB64, payloadB64, signatureB64] = parts

  // Verify signature using HMAC-SHA256
  const key = yield* Effect.promise(() => crypto.subtle.importKey(
    "raw",
    textEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"],
  ))

  const valid = yield* Effect.promise(() =>
    crypto.subtle.verify(
      "HMAC",
      key,
      base64UrlDecode(signatureB64),
      textEncoder().encode(`${headerB64}.${payloadB64}`),
    ),
  )

  if (!valid) return Option.none<UserContext.Info>()

  // Decode and check expiration
  const { info, exp } = decodeJwtPayload(payloadB64)
  if (exp && Date.now() / 1000 > exp) return Option.none<UserContext.Info>()

  if (!info.userID) return Option.none<UserContext.Info>()

  return Option.some(info)
})

export function required(config: Info) {
  return Option.isSome(config.password) && config.password.value !== ""
}

export function authorized(credentials: DecodedCredentials, config: Info) {
  return (
    Option.isSome(config.password) &&
    credentials.username === config.username &&
    Redacted.value(credentials.password) === config.password.value
  )
}

export function header(credentials?: Credentials) {
  const password = credentials?.password ?? process.env.OPENCODE_SERVER_PASSWORD
  if (!password) return undefined

  return `Basic ${Buffer.from(`${credentials?.username ?? process.env.OPENCODE_SERVER_USERNAME ?? "opencode"}:${password}`).toString("base64")}`
}

export function headers(credentials?: Credentials) {
  const authorization = header(credentials)
  if (!authorization) return undefined
  return { Authorization: authorization }
}
