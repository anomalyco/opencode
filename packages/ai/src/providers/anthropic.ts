import type { RouteDefaultsInput } from "../route/client.js"
import { Auth } from "../route/auth.js"
import type { ProviderAuthOption } from "../route/auth-options.js"
import type { ProviderPackage } from "../provider-package.js"
import { ProviderID, type ModelID } from "../schema/index.js"
import { AnthropicMessages } from "../protocols/anthropic-messages.js"
import { AnthropicCompatible } from "./anthropic-compatible.js"

export type AnthropicOptionsInput = AnthropicMessages.OptionsInput
export type AnthropicProviderOptionsInput = AnthropicMessages.ProviderOptionsInput
export type AnthropicThinkingInput = AnthropicMessages.ThinkingInput

export const id = ProviderID.make("anthropic")

export const routes = [AnthropicMessages.route]

export type Config = RouteDefaultsInput &
  ProviderAuthOption<"optional"> & {
    readonly baseURL?: string
    readonly providerOptions?: AnthropicMessages.ProviderOptionsInput
  }

export type Settings = ProviderPackage.Settings &
  (
    | { readonly apiKey?: string; readonly authToken?: never }
    | { readonly apiKey?: never; readonly authToken?: string }
  ) & {
    readonly baseURL?: string
    readonly providerOptions?: AnthropicMessages.ProviderOptionsInput
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
export const model: ProviderPackage.Definition<Settings, AnthropicMessages.ProviderOptionsInput>["model"] = (
  modelID,
  settings,
) => {
  if (settings.apiKey !== undefined && settings.authToken !== undefined)
    throw new Error("Anthropic apiKey cannot be combined with authToken")
  return configure({
    ...(settings.authToken === undefined ? { apiKey: settings.apiKey } : { auth: Auth.bearer(settings.authToken) }),
    baseURL: settings.baseURL,
    headers: settings.headers === undefined ? undefined : { ...settings.headers },
    http: settings.body === undefined ? undefined : { body: { ...settings.body } },
    providerOptions: settings.providerOptions,
  }).model(modelID)
}
