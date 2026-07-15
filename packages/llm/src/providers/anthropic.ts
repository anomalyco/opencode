import type { RouteDefaultsInput } from "../route/client"
import { Auth } from "../route/auth"
import type { ProviderAuthOption } from "../route/auth-options"
import type { ProviderPackage } from "../provider-package"
import { ProviderID, type ModelID } from "../schema"
import { AnthropicMessages } from "../protocols/anthropic-messages"
import { AnthropicCompatible } from "./anthropic-compatible"

export const id = ProviderID.make("anthropic")

export const routes = [AnthropicMessages.route]

export type Config = RouteDefaultsInput & ProviderAuthOption<"optional"> & { readonly baseURL?: string }

export type Settings = ProviderPackage.Settings &
  (
    | { readonly apiKey?: string; readonly authToken?: never }
    | { readonly apiKey?: never; readonly authToken?: string }
  ) & {
    readonly baseURL?: string
  }

const auth = (options: ProviderAuthOption<"optional">) => {
  if ("auth" in options && options.auth) return options.auth
  return Auth.optional("apiKey" in options ? options.apiKey : undefined, "apiKey")
    .orElse(Auth.config("ANTHROPIC_API_KEY"))
    .pipe(Auth.header("x-api-key"))
}

export const configure = (input: Config = {}) => {
  const { apiKey: _, auth: _auth, baseURL, ...rest } = input
  const compatible = AnthropicCompatible.configure({
    ...rest,
    auth: auth(input),
    baseURL: baseURL ?? AnthropicMessages.DEFAULT_BASE_URL,
    provider: id,
  })
  return {
    id,
    model: (modelID: string | ModelID) => compatible.model(modelID),
    configure,
  }
}

export const provider = configure()
export const model: ProviderPackage.Definition<Settings>["model"] = (modelID, settings) => {
  if (settings.apiKey !== undefined && settings.authToken !== undefined)
    throw new Error("Anthropic apiKey cannot be combined with authToken")
  return configure({
    ...(settings.authToken === undefined ? { apiKey: settings.apiKey } : { auth: Auth.bearer(settings.authToken) }),
    baseURL: settings.baseURL,
    headers: settings.headers === undefined ? undefined : { ...settings.headers },
    http: settings.body === undefined ? undefined : { body: { ...settings.body } },
    limits: settings.limits,
  }).model(modelID)
}
