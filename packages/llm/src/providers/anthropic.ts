import type { Config as EffectConfig, Redacted } from "effect"
import type { RouteDefaultsInput } from "../route/client"
import { Auth } from "../route/auth"
import type { ProviderAuthOption } from "../route/auth-options"
import { ProviderID, type ModelID } from "../schema"
import * as AnthropicMessages from "../protocols/anthropic-messages"

export const id = ProviderID.make("anthropic")

export const routes = [AnthropicMessages.route]

type AnthropicSecret = string | Redacted.Redacted | EffectConfig.Config<string | Redacted.Redacted>

export type Config = RouteDefaultsInput &
  ProviderAuthOption<"optional"> & {
    readonly baseURL?: string
    readonly authToken?: AnthropicSecret
  }

const auth = (options: Config) => {
  if ("auth" in options && options.auth) return options.auth
  // `authToken` sends `Authorization: Bearer` (OAuth and bearer gateways);
  // `apiKey` sends `x-api-key`. Prefer an explicit authToken so custom
  // baseURL + authToken gateways do not 401 on `x-api-key`.
  if ("authToken" in options && options.authToken !== undefined) {
    return Auth.optional(options.authToken, "authToken").bearer()
  }
  return Auth.optional("apiKey" in options ? options.apiKey : undefined, "apiKey")
    .orElse(Auth.config("ANTHROPIC_API_KEY"))
    .pipe(Auth.header("x-api-key"))
}

const configuredRoute = (input: Config) => {
  const { apiKey: _, auth: _auth, authToken: _authToken, baseURL, ...rest } = input
  return AnthropicMessages.route.with({ ...rest, endpoint: { baseURL }, auth: auth(input) })
}

export const configure = (input: Config = {}) => {
  const route = configuredRoute(input)
  return {
    id,
    model: (modelID: string | ModelID) => route.model({ id: modelID }),
    configure,
  }
}

export const provider = configure()
export const model = provider.model
