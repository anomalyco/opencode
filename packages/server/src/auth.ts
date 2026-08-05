export * as ServerAuth from "./auth"

import { Context, Layer, Option, Redacted } from "effect"

export type DecodedCredentials = {
  readonly username: string
  readonly password: Redacted.Redacted
}

export type Info = {
  readonly password: Option.Option<string>
  readonly username: string
}

export class Config extends Context.Service<Config, Info>()("@opencode/ServerAuthConfig") {
  static configLayer(input: Pick<Info, "password">) {
    return Layer.succeed(this, this.of({ ...input, username: "opencode" }))
  }

  static get layer() {
    return this.configLayer({ password: Option.none() })
  }
}

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
