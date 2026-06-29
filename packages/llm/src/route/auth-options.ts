import type { Config, Redacted } from "effect"
import { Auth } from "./auth"

export type ApiKeyMode = "optional" | "required"

export type AuthOverride = {
  readonly auth: Auth
  readonly apiKey?: never
}

export type OptionalApiKeyAuth = {
  readonly apiKey?: string | Redacted.Redacted<string> | Config.Config<string | Redacted.Redacted<string>>
  readonly auth?: never
}

export type RequiredApiKeyAuth = {
  readonly apiKey: string | Redacted.Redacted<string> | Config.Config<string | Redacted.Redacted<string>>
  readonly auth?: never
}

export type ProviderAuthOption<Mode extends ApiKeyMode> =
  | AuthOverride
  | (Mode extends "optional" ? OptionalApiKeyAuth : RequiredApiKeyAuth)

export type ModelOptions<Base, Mode extends ApiKeyMode> = Omit<Base, "apiKey" | "auth"> & ProviderAuthOption<Mode>

export type ModelArgs<Base, Mode extends ApiKeyMode> = Mode extends "optional"
  ? readonly [options?: ModelOptions<Base, Mode>]
  : readonly [options: ModelOptions<Base, Mode>]

export type ModelFactory<Base, Mode extends ApiKeyMode, Model> = (id: string, ...args: ModelArgs<Base, Mode>) => Model

/**
 * Require at least one of the keys in `T`. Use for option shapes where any
 * subset of fields is acceptable but at least one must be present (e.g. Azure
 * accepts `resourceName` or `baseURL`).
 */
export type AtLeastOne<T> = {
  [K in keyof T]: Required<Pick<T, K>> & Partial<Omit<T, K>>
}[keyof T]

/**
 * Standard bearer-auth resolution for providers: honor an explicit `auth`
 * override, otherwise resolve `apiKey` (option > config var) and apply it as
 * a bearer token.
 */
export const bearer = (options: ProviderAuthOption<"optional">, envVar: string | ReadonlyArray<string>): Auth => {
  if ("auth" in options && options.auth) return options.auth
  return (Array.isArray(envVar) ? envVar : [envVar])
    .reduce(
      (auth, name) => auth.orElse(Auth.config(name)),
      Auth.optional("apiKey" in options ? options.apiKey : undefined, "apiKey"),
    )
    .bearer()
}

export * as AuthOptions from "./auth-options"
