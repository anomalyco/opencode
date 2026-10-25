export * as ServerAuth from "./auth"

import { createHash, timingSafeEqual } from "node:crypto"
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

export class Config extends Context.Service<Config, Info>()("@bolt/ServerAuthConfig") {
  static configLayer(input: Info) {
    return Layer.succeed(this, this.of(input))
  }

  static get layer() {
    return Layer.effect(
      this,
      Effect.gen(function* () {
        return Config.of(
          yield* EffectConfig.all({
            password: EffectConfig.string("BOLT_SERVER_PASSWORD").pipe(EffectConfig.option),
            username: EffectConfig.string("BOLT_SERVER_USERNAME").pipe(EffectConfig.withDefault("bolt")),
          }),
        )
      }),
    )
  }
}

export function required(config: Info) {
  return Option.isSome(config.password) && config.password.value !== ""
}

// Session tokens issued by pairing links are accepted anywhere the password is.
export function authorized(credentials: DecodedCredentials, config: Info) {
  if (Option.isNone(config.password)) return false
  // Evaluate both comparisons so a username mismatch does not skip the
  // password hash, which would leak username validity through timing.
  const username = equals(credentials.username, config.username)
  const password = equals(Redacted.value(credentials.password), config.password.value)
  return username && password
}

// Constant-time comparison so the password cannot be recovered byte-by-byte
// through response timing. Hashing first equalizes lengths, which
// timingSafeEqual requires (and avoids leaking the length itself).
function equals(a: string, b: string) {
  const hash = (value: string) => createHash("sha256").update(value).digest()
  return timingSafeEqual(hash(a), hash(b))
}

export function header(credentials?: Credentials) {
  const password = credentials?.password ?? process.env.BOLT_SERVER_PASSWORD
  if (!password) return undefined

  return `Basic ${Buffer.from(`${credentials?.username ?? process.env.BOLT_SERVER_USERNAME ?? "bolt"}:${password}`).toString("base64")}`
}

export function verifySession(token: string, config: Info, now = Date.now()) {
  if (Option.isNone(config.password)) return false
  const parts = token.split(".")
  if (parts.length !== 2) return false
  const expires = Number(parts[0])
  if (!Number.isSafeInteger(expires) || expires * 1000 <= now) return false
  const expected = Buffer.from(sign(config.password.value, parts[0]))
  const actual = Buffer.from(parts[1])
  return actual.length === expected.length && timingSafeEqual(actual, expected)
}

// Browsers share cookies across ports on the same host, so the name carries the port to keep local servers apart.
export function sessionCookieName(host: string | undefined) {
  const port = URL.parse(`http://${host ?? ""}`)?.port
  return port ? `opencode_session_${port}` : "opencode_session"
}

function sign(password: string, payload: string) {
  const key = createHmac("sha256", password).update("opencode-session-v1").digest()
  return createHmac("sha256", key).update(payload).digest("base64url")
}
