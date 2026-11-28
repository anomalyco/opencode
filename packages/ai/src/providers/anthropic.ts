import { Auth } from "../route/auth.js"
import { AuthOptions, type ProviderAuthOption } from "../route/auth-options.js"
import type { ProviderPackage } from "../provider-package.js"
import { ProviderConfigurationError, ProviderID, type ModelID, type RequestOptions } from "../schema/index.js"
import { AnthropicMessages } from "../protocols/anthropic-messages.js"
import { AnthropicCompatible } from "./anthropic-compatible.js"

export type AnthropicOptionsInput = AnthropicMessages.OptionsInput
export type AnthropicProviderOptionsInput = AnthropicMessages.ProviderOptionsInput
export type AnthropicThinkingInput = AnthropicMessages.ThinkingInput

export const id = ProviderID.make("anthropic")

export const routes = [AnthropicMessages.route]

export type Config = RequestOptions &
  ProviderAuthOption<"optional"> & {
    readonly baseURL?: string
    readonly providerOptions?: AnthropicMessages.ProviderOptionsInput
  }

export type Settings = ProviderPackage.Settings &
  AnthropicMessages.ProviderOptionsInput &
  (
    | { readonly apiKey?: string | false; readonly authToken?: never }
    | { readonly apiKey?: never; readonly authToken?: string }
  ) & {
    readonly baseURL?: string
  }

const auth = (options: ProviderAuthOption<"optional">) =>
  AuthOptions.apiKey(options, "ANTHROPIC_API_KEY", Auth.header("x-api-key"))

export const configure = (input: Config = {}) => {
  const { apiKey: _, auth: _auth, baseURL = AnthropicMessages.DEFAULT_BASE_URL, ...rest } = input
  const compatible = AnthropicCompatible.configure({
    ...rest,
    // Every step resends the whole transcript, and api.anthropic.com decodes gzip bodies (not zstd or br).
    // A proxy or gateway at another URL may not, so it keeps plain JSON unless asked.
    http:
      baseURL.replace(/\/+$/, "") === AnthropicMessages.DEFAULT_BASE_URL
        ? { ...rest.http, encoding: rest.http?.encoding ?? "gzip" }
        : rest.http,
    auth: auth(input),
    baseURL,
    provider: id,
  })
  return {
    id,
    model: (modelID: string | ModelID) => compatible.model(modelID),
    configure,
  }
}

export const provider = configure()
export const model: ProviderPackage.Model<Settings, AnthropicMessages.ProviderOptionsInput> = (
  modelID,
  { apiKey, authToken, baseURL, body, headers, ...providerOptions }: Settings = {},
) => {
  if (apiKey !== undefined && authToken !== undefined)
    throw new ProviderConfigurationError({
      provider: id,
      message: "Anthropic apiKey cannot be combined with authToken",
    })
  return configure({
    ...(authToken === undefined ? { apiKey: apiKey } : { auth: Auth.bearer(authToken) }),
    baseURL,
    headers,
    http: body === undefined ? undefined : { body },
    providerOptions,
  }).model(modelID)
}
