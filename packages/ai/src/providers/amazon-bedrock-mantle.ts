import { Route, type RouteDefaultsInput } from "../route/client.js"
import { Endpoint } from "../route/endpoint.js"
import type { ProviderPackage } from "../provider-package.js"
import { AnthropicMessages } from "../protocols/anthropic-messages.js"
import { OpenAIChat } from "../protocols/openai-chat.js"
import { OpenResponses } from "../protocols/open-responses.js"
import { BedrockAuth, type Credentials } from "../protocols/utils/bedrock-auth.js"
import { claudeVersion } from "../protocols/utils/claude-model.js"
import { ProviderConfigurationError, ProviderID, type ModelID } from "../schema/index.js"
import { withOpenAIOptions, type OpenAIProviderOptionsInput } from "./openai-options.js"

export const id = ProviderID.make("amazon-bedrock")

export type OpenAIOptionsInput = OpenAIProviderOptionsInput
export type MessagesOptionsInput = AnthropicMessages.ProviderOptionsInput

export type Config = Omit<RouteDefaultsInput, "providerOptions"> & {
  /** Bedrock API key. Falls back to `AWS_BEARER_TOKEN_BEDROCK`; bearer auth takes precedence over SigV4. */
  readonly apiKey?: string
  /** `sigv4` ignores `apiKey` fallbacks from the environment; `bearer` requires a token. */
  readonly auth?: "bearer" | "sigv4"
  readonly baseURL?: string
  /** Static SigV4 credentials. When omitted the AWS default credential chain resolves them per request. */
  readonly credentials?: Credentials
  /** Shared config profile for the default credential chain. */
  readonly profile?: string
  readonly region?: string
  readonly providerOptions?: OpenAIProviderOptionsInput | AnthropicMessages.ProviderOptionsInput
}

export type Settings<Options = OpenAIProviderOptionsInput> = ProviderPackage.Settings &
  Options & {
    readonly apiKey?: string
    readonly auth?: "bearer" | "sigv4"
    readonly baseURL?: string
    readonly credentials?: Credentials
    readonly profile?: string
    readonly region?: string
    readonly topP?: number
  }

export type MessagesSettings = Settings<AnthropicMessages.ProviderOptionsInput>

const responsesRoute = Route.make({
  id: "bedrock-mantle-responses",
  provider: id,
  providerMetadataKey: "mantle",
  protocol: OpenResponses.protocol,
  endpoint: Endpoint.path(OpenResponses.PATH),
  transport: OpenResponses.httpTransport,
  defaults: { providerOptions: { store: false, include: ["reasoning.encrypted_content"] } },
})

const chatRoute = OpenAIChat.route.with({
  id: "bedrock-mantle-chat",
  provider: id,
  providerMetadataKey: "mantle",
})

const messagesRoute = Route.make({
  id: "bedrock-mantle-messages",
  provider: id,
  providerMetadataKey: "mantle",
  protocol: {
    ...AnthropicMessages.protocol,
    // Mantle rejects mid-conversation `output_config` on Opus 5.0; support starts at 5.1+.
    supportsEffortUpdates: (request) => {
      if (!(AnthropicMessages.protocol.supportsEffortUpdates?.(request) ?? false)) return false
      if (request.model.compatibility?.supportsEffortUpdates !== undefined) return true
      const version = claudeVersion(request.model.id)
      return version !== undefined && (version.major > 5 || (version.major === 5 && version.minor >= 1))
    },
  },
  endpoint: Endpoint.path(AnthropicMessages.PATH),
  transport: AnthropicMessages.transport<AnthropicMessages.AnthropicMessagesBody>(),
  headers: () => ({ "anthropic-version": "2023-06-01" }),
})

export const routes = [responsesRoute, chatRoute, messagesRoute]

const configuredRoute = <Body, Prepared>(
  route: Route<Body, Prepared>,
  input: Config,
  defaultBaseURL = (region: string) => `https://bedrock-mantle.${region}.api.aws/v1`,
) => {
  const region = BedrockAuth.resolveRegion(input)
  return route.with({
    endpoint: { baseURL: input.baseURL ?? defaultBaseURL(region) },
    auth: BedrockAuth.resolveAuth(input, region, {
      service: "bedrock-mantle",
      name: "Bedrock Mantle",
      mode: input.auth,
    }),
  })
}

const defaults = (input: Config) => {
  const {
    apiKey: _,
    auth: _auth,
    baseURL: _baseURL,
    credentials: _credentials,
    profile: _profile,
    region: _region,
    ...rest
  } = input
  return rest
}

export const configure = (input: Config = {}) => {
  if (input.auth === "bearer" && input.apiKey === undefined && process.env.AWS_BEARER_TOKEN_BEDROCK === undefined)
    throw new ProviderConfigurationError({ provider: id, message: "Amazon Bedrock Mantle bearer auth requires apiKey" })
  if (input.auth === "sigv4" && input.apiKey !== undefined)
    throw new ProviderConfigurationError({
      provider: id,
      message: "Amazon Bedrock Mantle SigV4 auth does not accept apiKey",
    })
  const configuredResponsesRoute = configuredRoute(responsesRoute, input)
  const configuredChatRoute = configuredRoute(chatRoute, input)
  const configuredMessagesRoute = configuredRoute(
    messagesRoute,
    input,
    (region) => `https://bedrock-mantle.${region}.api.aws/anthropic/v1`,
  )
  const modelDefaults = defaults(input)
  const responses = (modelID: string | ModelID) =>
    configuredResponsesRoute
      .with(withOpenAIOptions(modelID, modelDefaults))
      .model<OpenAIProviderOptionsInput>({ id: modelID })
  const chat = (modelID: string | ModelID) =>
    configuredChatRoute
      .with(withOpenAIOptions(modelID, modelDefaults))
      .model<OpenAIProviderOptionsInput>({ id: modelID })
  const messages = (modelID: string | ModelID) =>
    configuredMessagesRoute.with(modelDefaults).model<AnthropicMessages.ProviderOptionsInput>({ id: modelID })

  return {
    id,
    model: responses,
    chat,
    messages,
    responses,
    configure,
  }
}

export const provider = configure()

const fromSettings = ({
  apiKey,
  auth,
  baseURL,
  body,
  credentials,
  headers,
  profile,
  region,
  topP,
  ...providerOptions
}: Settings<Config["providerOptions"]>) =>
  configure({
    apiKey,
    auth,
    baseURL,
    credentials,
    generation: topP === undefined ? undefined : { topP },
    headers,
    http: body === undefined ? undefined : { body },
    profile,
    providerOptions,
    region,
  })

export const chatModel: ProviderPackage.Definition<Settings, OpenAIProviderOptionsInput>["model"] = (
  modelID,
  settings,
) => fromSettings(settings).chat(modelID)
export const messagesModel: ProviderPackage.Definition<
  MessagesSettings,
  AnthropicMessages.ProviderOptionsInput
>["model"] = (modelID, settings) => fromSettings(settings).messages(modelID)
export const responsesModel: ProviderPackage.Definition<Settings, OpenAIProviderOptionsInput>["model"] = (
  modelID,
  settings,
) => fromSettings(settings).responses(modelID)
export const model = responsesModel
