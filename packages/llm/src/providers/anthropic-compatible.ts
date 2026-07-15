import type { ProviderPackage } from "../provider-package"
import { AnthropicMessages } from "../protocols/anthropic-messages"
import { Auth } from "../route/auth"
import type { ProviderAuthOption } from "../route/auth-options"
import type { RouteDefaultsInput } from "../route/client"
import { ProviderID, type ModelID } from "../schema"

export const id = ProviderID.make("anthropic-compatible")

export type Config = RouteDefaultsInput &
  ProviderAuthOption<"optional"> & {
    readonly provider?: string
    readonly baseURL: string
  }

export type Settings = ProviderPackage.Settings &
  (
    | { readonly apiKey?: string; readonly authToken?: never }
    | { readonly apiKey?: never; readonly authToken?: string }
  ) & {
    readonly baseURL: string
    readonly provider?: string
  }

export const routes = [AnthropicMessages.route]

const auth = (input: ProviderAuthOption<"optional">) => {
  if ("auth" in input && input.auth) return input.auth
  return Auth.optional("apiKey" in input ? input.apiKey : undefined, "apiKey").pipe(Auth.header("x-api-key"))
}

export const configure = (input: Config) => {
  if (!input.baseURL) throw new Error("Anthropic-compatible providers require a baseURL")
  const provider = input.provider ?? "anthropic-compatible"
  const { provider: _, baseURL, apiKey: _apiKey, auth: _auth, ...rest } = input
  const route = AnthropicMessages.route.with({
    ...rest,
    provider,
    endpoint: { baseURL },
    auth: auth(input),
  })
  return {
    id: ProviderID.make(provider),
    model: (modelID: string | ModelID) => route.model({ id: modelID }),
    configure,
  }
}

export const provider = {
  id,
  configure,
}

export const model: ProviderPackage.Definition<Settings>["model"] = (modelID, settings) => {
  if (settings.apiKey !== undefined && settings.authToken !== undefined)
    throw new Error("Anthropic-compatible apiKey cannot be combined with authToken")
  return configure({
    ...(settings.authToken === undefined ? { apiKey: settings.apiKey } : { auth: Auth.bearer(settings.authToken) }),
    baseURL: settings.baseURL,
    headers: settings.headers === undefined ? undefined : { ...settings.headers },
    http: settings.body === undefined ? undefined : { body: { ...settings.body } },
    limits: settings.limits,
    provider: settings.provider,
  }).model(modelID)
}

export * as AnthropicCompatible from "./anthropic-compatible"
