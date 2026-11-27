import type { ProviderPackage } from "../provider-package.js"
import { AnthropicMessages } from "../protocols/anthropic-messages.js"
import { Provider } from "../provider.js"
import { Auth } from "../route/auth.js"
import { ProviderConfigurationError, ProviderID } from "../schema/index.js"

export type AnthropicOptionsInput = AnthropicMessages.OptionsInput
export type AnthropicProviderOptionsInput = AnthropicMessages.ProviderOptionsInput
export type AnthropicThinkingInput = AnthropicMessages.ThinkingInput

export const id = ProviderID.make("anthropic-compatible")

export type Settings = ProviderPackage.Settings &
  AnthropicMessages.ProviderOptionsInput &
  (
    | { readonly apiKey?: string | false; readonly authToken?: never }
    | { readonly apiKey?: never; readonly authToken?: string }
  ) & {
    readonly baseURL: string
    readonly provider?: string
  }

/** Anthropic's own Messages hosts: an `x-api-key` key, or an `authToken` sent as a bearer token. */
export const shared = {
  auth: (env: ReadonlyArray<string>) => Provider.apiKey(env, (credential) => credential.header("x-api-key")),
  settings: {
    keys: ["authToken"],
    patch: (values: Pick<Settings, "authToken">) =>
      values.authToken === undefined ? {} : { auth: Auth.bearer(values.authToken) },
  },
  api: AnthropicMessages.api,
}

/** Fails like Anthropic when both an API key and an auth token are given. */
export const requireOneCredential = (
  provider: string,
  settings: Pick<Settings, "apiKey" | "authToken">,
  name: string,
) => {
  if (settings.apiKey !== undefined && settings.authToken !== undefined)
    throw new ProviderConfigurationError({
      provider: ProviderID.make(provider),
      message: `${name} apiKey cannot be combined with authToken`,
    })
}

export const model: ProviderPackage.Model<Settings, AnthropicMessages.ProviderOptionsInput, undefined> = (
  modelID,
  { provider, ...settings },
) => {
  requireOneCredential(provider ?? id, settings, "Anthropic-compatible")
  if (!settings.baseURL)
    throw new ProviderConfigurationError({
      provider: ProviderID.make(provider ?? id),
      message: "Anthropic-compatible providers require a baseURL",
    })
  return Provider.entrypoint<ProviderPackage.Settings, AnthropicMessages.ProviderOptionsInput, undefined>(
    Provider.make({
      id: provider ?? id,
      auth: shared.auth([]),
      apis: [shared.api.configure({ id: "anthropic-compatible-messages" })],
      settings: shared.settings,
    }),
  )(modelID, settings)
}

export * as AnthropicCompatible from "./anthropic-compatible.js"
