import type { Config, Redacted } from "effect"
import { Auth } from "./auth.js"

export type ApiKeyMode = "optional" | "required"

export type AuthOverride = {
  readonly auth: Auth.Definition
  readonly apiKey?: never
}

/** `false` marks a provider that needs no key: no env lookup and no auth header from the package. */
export type ApiKey = string | Redacted.Redacted<string> | Config.Config<string | Redacted.Redacted<string>> | false

export type OptionalApiKeyAuth = {
  readonly apiKey?: ApiKey
  readonly auth?: never
}

export type RequiredApiKeyAuth = {
  readonly apiKey: ApiKey
  readonly auth?: never
}

export type ProviderAuthOption<Mode extends ApiKeyMode> =
  | AuthOverride
  | (Mode extends "optional" ? OptionalApiKeyAuth : RequiredApiKeyAuth)

/**
 * Require at least one of the keys in `T`. Use for option shapes where any
 * subset of fields is acceptable but at least one must be present (e.g. Azure
 * accepts `resourceName` or `baseURL`).
 */
export type AtLeastOne<T> = {
  [K in keyof T]: Required<Pick<T, K>> & Partial<Omit<T, K>>
}[keyof T]

/**
 * Standard API-key resolution for providers: honor an explicit `auth`
 * override, skip auth entirely for `apiKey: false`, otherwise resolve `apiKey`
 * (option > config vars) and render it with `apply`.
 */
export const apiKey = (
  options: ProviderAuthOption<"optional">,
  envVar: string | ReadonlyArray<string>,
  apply: (credential: Auth.Credential) => Auth.Definition,
): Auth.Definition => {
  if ("auth" in options && options.auth) return options.auth
  const key = "apiKey" in options ? options.apiKey : undefined
  if (key === false) return Auth.none
  return apply(
    (Array.isArray(envVar) ? envVar : [envVar]).reduce(
      (auth, name) => auth.orElse(Auth.config(name)),
      Auth.optional(key, "apiKey"),
    ),
  )
}

/** `apiKey` resolution applied as `Authorization: Bearer <key>`. */
export const bearer = (options: ProviderAuthOption<"optional">, envVar: string | ReadonlyArray<string>) =>
  apiKey(options, envVar, (credential) => credential.bearer())

export * as AuthOptions from "./auth-options.js"
