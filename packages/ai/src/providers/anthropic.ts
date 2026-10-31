import { Route, type RouteDefaultsInput } from "../route/client.js"
import { Endpoint } from "../route/endpoint.js"
import { Auth } from "../route/auth.js"
import { AuthOptions, type ProviderAuthOption } from "../route/auth-options.js"
import type { ProviderPackage } from "../provider-package.js"
import { ProviderConfigurationError, ProviderID, type ModelID } from "../schema/index.js"
import { AnthropicMessages } from "../protocols/anthropic-messages.js"
import { OpenAIChat } from "../protocols/openai-chat.js"
import { AnthropicCompatible } from "./anthropic-compatible.js"
import type { OpenAIProviderOptionsInput } from "./openai-options.js"

export type AnthropicOptionsInput = AnthropicMessages.OptionsInput
export type AnthropicProviderOptionsInput = AnthropicMessages.ProviderOptionsInput
export type AnthropicThinkingInput = AnthropicMessages.ThinkingInput

export const id = ProviderID.make("anthropic")

// Anthropic's OpenAI SDK compatibility layer: https://platform.claude.com/docs/en/cli-sdks-libraries/libraries/openai-sdk
const chatRoute = Route.make({
  id: "anthropic-chat",
  provider: id,
  providerMetadataKey: "anthropic",
  protocol: OpenAIChat.protocol,
  endpoint: Endpoint.path("/chat/completions", { baseURL: AnthropicMessages.DEFAULT_BASE_URL }),
  framing: OpenAIChat.framing,
})

export const routes = [AnthropicMessages.route, chatRoute]

export type Config = RouteDefaultsInput &
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

export type ChatSettings = ProviderPackage.Settings &
  OpenAIProviderOptionsInput & {
    readonly apiKey?: string | false
    readonly baseURL?: string
  }

const auth = (options: ProviderAuthOption<"optional">) =>
  AuthOptions.apiKey(options, "ANTHROPIC_API_KEY", Auth.header("x-api-key"))

export const configure = (input: Config = {}) => {
  const { apiKey: _, auth: _auth, baseURL, providerOptions, ...defaults } = input
  const compatible = AnthropicCompatible.configure({
    ...defaults,
    providerOptions,
    auth: auth(input),
    baseURL: baseURL ?? AnthropicMessages.DEFAULT_BASE_URL,
    provider: id,
  })
  // Messages provider options don't apply to Chat; pass Chat options through `chatModel` instead.
  const chatRoute = configuredChat({ ...defaults, baseURL, auth: chatAuth(input) })
  return {
    id,
    model: (modelID: string | ModelID) => compatible.model(modelID),
    chat: (modelID: string | ModelID) => chatRoute.model<OpenAIProviderOptionsInput>({ id: modelID }),
    configure,
  }
}

const chatAuth = (options: ProviderAuthOption<"optional">) => AuthOptions.bearer(options, "ANTHROPIC_API_KEY")

const configuredChat = ({
  baseURL,
  ...rest
}: Omit<RouteDefaultsInput, "providerOptions"> & {
  readonly baseURL?: string
  readonly auth: Auth.Definition
  readonly providerOptions?: OpenAIProviderOptionsInput
}) => chatRoute.with({ ...rest, endpoint: { baseURL: baseURL ?? AnthropicMessages.DEFAULT_BASE_URL } })

export const provider = configure()
export const chat = provider.chat
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

export const chatModel: ProviderPackage.Model<ChatSettings, OpenAIProviderOptionsInput> = (
  modelID,
  { apiKey, baseURL, body, headers, ...providerOptions }: ChatSettings = {},
) =>
  configuredChat({
    auth: chatAuth({ apiKey }),
    baseURL,
    headers,
    http: body === undefined ? undefined : { body },
    providerOptions,
  }).model<OpenAIProviderOptionsInput>({ id: modelID })
