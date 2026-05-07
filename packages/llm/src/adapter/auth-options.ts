import type { Auth, SecretInput } from "./auth"

export type ApiKeyMode = "optional" | "required"
export type ApiKeyInput = SecretInput

export type AuthOverride = {
  readonly auth: Auth
  readonly apiKey?: never
}

export type OptionalApiKeyAuth = {
  readonly apiKey?: ApiKeyInput
  readonly auth?: never
}

export type RequiredApiKeyAuth = {
  readonly apiKey: ApiKeyInput
  readonly auth?: never
}

export type ProviderAuthOption<Mode extends ApiKeyMode> =
  | AuthOverride
  | (Mode extends "optional" ? OptionalApiKeyAuth : RequiredApiKeyAuth)

export type ModelOptions<Base, Mode extends ApiKeyMode> = Omit<Base, "apiKey" | "auth"> & ProviderAuthOption<Mode>

export type ModelArgs<Base, Mode extends ApiKeyMode> = Mode extends "optional"
  ? readonly [options?: ModelOptions<Base, Mode>]
  : readonly [options: ModelOptions<Base, Mode>]

export type ModelFactory<Base, Mode extends ApiKeyMode, Model> = (
  id: string,
  ...args: ModelArgs<Base, Mode>
) => Model

export * as AuthOptions from "./auth-options"
