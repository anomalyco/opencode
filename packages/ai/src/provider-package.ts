import { Auth } from "./route/auth.js"
import type { AuthOverride, RequiredApiKeyAuth } from "./route/auth-options.js"
import type { LanguageModel, ProviderOptions } from "./schema/index.js"

export interface Settings {}

export type Credential =
  | {
      readonly type: "key"
      readonly value: string
      readonly configuration?: Readonly<Record<string, unknown>>
    }
  | {
      readonly type: "oauth"
      readonly accessToken: string
    }

export interface Defaults {
  readonly headers?: Readonly<Record<string, string>>
  readonly body?: Readonly<Record<string, unknown>>
  readonly limits?: {
    readonly context: number
    readonly input?: number
    readonly output: number
  }
}

export interface ModelInput<ProviderSettings extends Settings = Settings> {
  readonly id: string
  readonly settings: ProviderSettings
  readonly credential?: Credential
  readonly defaults: Defaults
}

export const routeDefaults = (input: Defaults) => ({
  headers: input.headers,
  http: input.body === undefined ? undefined : { body: input.body },
  limits: input.limits,
})

export const bearerCredentialValue = (input: Credential) => (input.type === "key" ? input.value : input.accessToken)

export const bearerAuthOption = (input: Credential): AuthOverride => ({
  auth: Auth.bearer(bearerCredentialValue(input)),
})

export const apiKeyOrBearerAuthOption = (
  input: Credential,
  competingKeyHeader: string,
): RequiredApiKeyAuth | AuthOverride =>
  input.type === "key"
    ? { apiKey: input.value }
    : { auth: Auth.remove(competingKeyHeader).andThen(Auth.bearer(input.accessToken)) }

export interface Definition<
  ProviderSettings extends Settings = Settings,
  Options extends ProviderOptions = ProviderOptions,
> {
  readonly model: (input: ModelInput<ProviderSettings>) => LanguageModel<Options>
}

export * as ProviderPackage from "./provider-package.js"
