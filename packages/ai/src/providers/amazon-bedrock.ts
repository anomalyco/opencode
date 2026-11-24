import { Route } from "../route/client.js"
import { Endpoint } from "../route/endpoint.js"
import type { ProviderPackage } from "../provider-package.js"
import { AnthropicMessages } from "../protocols/anthropic-messages.js"
import { BedrockConverse, type BedrockCredentials } from "../protocols/bedrock-converse.js"
import { OpenAIChat } from "../protocols/openai-chat.js"
import { OpenResponses } from "../protocols/open-responses.js"
import { BedrockAuth } from "../protocols/utils/bedrock-auth.js"
import { ProviderConfigurationError, ProviderID, type ModelID, type RequestOptions } from "../schema/index.js"
import { withOpenAIOptions, type OpenAIProviderOptionsInput } from "./openai-options.js"

export const id = ProviderID.make("amazon-bedrock")

export type OpenAIOptionsInput = OpenAIProviderOptionsInput
export type MessagesOptionsInput = AnthropicMessages.ProviderOptionsInput

export type Config<Options = BedrockConverse.OptionsInput> = RequestOptions & {
  /** Bedrock API key. Falls back to `AWS_BEARER_TOKEN_BEDROCK`; bearer auth takes precedence over SigV4. */
  readonly apiKey?: string
  /** `sigv4` ignores `apiKey` fallbacks from the environment; `bearer` requires a token. */
  readonly auth?: "bearer" | "sigv4"
  readonly headers?: Record<string, string>
  /** Static SigV4 credentials. When omitted the AWS default credential chain resolves them per request. */
  readonly credentials?: BedrockCredentials
  /** Shared config profile for the default credential chain. */
  readonly profile?: string
  /** AWS region. Falls back to `credentials.region`, `AWS_REGION`, `AWS_DEFAULT_REGION`, then `us-east-1`. */
  readonly region?: string
  /** Override the regional endpoint. Chat and Responses append `/openai/v1` to an origin; Messages appends `/anthropic/v1`. */
  readonly baseURL?: string
  readonly providerOptions?: Options
}

export type Settings<Options = BedrockConverse.OptionsInput> = ProviderPackage.Settings &
  Options &
  Pick<Config, "apiKey" | "auth" | "baseURL" | "credentials" | "profile" | "region" | "topP">

export type OpenAISettings = Settings<OpenAIOptionsInput>
export type MessagesSettings = Settings<MessagesOptionsInput>

const chatRoute = OpenAIChat.route.with({
  id: "bedrock-runtime-chat",
  provider: id,
  providerMetadataKey: "bedrock-runtime",
})

const responsesRoute = Route.make({
  id: "bedrock-runtime-responses",
  provider: id,
  providerMetadataKey: "bedrock-runtime",
  protocol: OpenResponses.protocol,
  endpoint: Endpoint.path(OpenResponses.PATH),
  transport: OpenResponses.httpTransport,
  options: { providerOptions: { include: ["reasoning.encrypted_content"] } },
})

const messagesRoute = Route.make({
  id: "bedrock-runtime-messages",
  provider: id,
  providerMetadataKey: "bedrock-runtime",
  protocol: AnthropicMessages.protocol,
  endpoint: Endpoint.path(AnthropicMessages.PATH),
  transport: AnthropicMessages.transport<AnthropicMessages.AnthropicMessagesBody>(),
  headers: () => ({ "anthropic-version": "2023-06-01" }),
})

export const routes = [BedrockConverse.route, chatRoute, responsesRoute, messagesRoute]

type RuntimeOptions = BedrockConverse.OptionsInput | OpenAIOptionsInput | MessagesOptionsInput

export const configure = (input: Config<RuntimeOptions> = {}) => {
  const { apiKey, auth, credentials, profile, region, baseURL, ...defaults } = input
  if (auth === "bearer" && apiKey === undefined && process.env.AWS_BEARER_TOKEN_BEDROCK === undefined)
    throw new ProviderConfigurationError({ provider: id, message: "Amazon Bedrock bearer auth requires apiKey" })
  if (auth === "sigv4" && apiKey !== undefined)
    throw new ProviderConfigurationError({ provider: id, message: "Amazon Bedrock SigV4 auth does not accept apiKey" })
  const resolvedRegion = BedrockAuth.resolveRegion({ region, credentials })
  const root = baseURL ?? `https://bedrock-runtime.${resolvedRegion}.amazonaws.com`
  const connection = { apiKey, credentials, profile }
  const runtimeAuth = BedrockAuth.resolveAuth(connection, resolvedRegion, { name: "Bedrock Runtime", mode: auth })
  const configuredConverse = BedrockConverse.route.with({
    ...defaults,
    provider: id,
    providerMetadataKey: "bedrock",
    endpoint: { baseURL: root },
    auth: runtimeAuth,
  })
  const url = Endpoint.trimBaseUrl(root)
  const origin = /^https?:\/\/[^/?#]+$/.test(url)
  // Existing Bedrock endpoint origins (including VPC endpoints) also serve the native APIs.
  const openAIConfig = { endpoint: { baseURL: origin ? `${url}/openai/v1` : url }, auth: runtimeAuth }
  const configuredChat = chatRoute.with(openAIConfig)
  const configuredResponses = responsesRoute.with(openAIConfig)
  const configuredMessages = messagesRoute.with({
    endpoint: {
      baseURL: origin ? `${url}/anthropic/v1` : /^https?:\/\/[^/?#]+\/anthropic$/.test(url) ? `${url}/v1` : url,
    },
    auth: BedrockAuth.resolveAuth(connection, resolvedRegion, {
      name: "Bedrock Runtime",
      mode: auth,
      apiKeyHeader: "x-api-key",
    }),
  })

  const converse = (modelID: string | ModelID) =>
    configuredConverse.model<BedrockConverse.OptionsInput>({ id: modelID })
  return {
    id,
    model: converse,
    converse,
    chat: (modelID: string | ModelID) =>
      configuredChat
        .with(withOpenAIOptions(modelID, defaults))
        .model<OpenAIOptionsInput>({ id: modelID, compatibility: { maxTokensField: "max_tokens" } }),
    responses: (modelID: string | ModelID) =>
      configuredResponses.with(withOpenAIOptions(modelID, defaults)).model<OpenAIOptionsInput>({ id: modelID }),
    messages: (modelID: string | ModelID) =>
      configuredMessages.with(defaults).model<MessagesOptionsInput>({ id: modelID }),
    configure,
  }
}

export const provider = configure()
export const converse = provider.converse
export const chat = provider.chat
export const responses = provider.responses
export const messages = provider.messages

const fromSettings = ({
  apiKey,
  auth,
  baseURL,
  credentials,
  profile,
  region,
  topP,
  headers,
  body,
  ...providerOptions
}: Settings<RuntimeOptions> = {}) =>
  configure({
    apiKey,
    auth,
    baseURL,
    credentials,
    topP,
    headers: headers === undefined ? undefined : { ...headers },
    http: body === undefined ? undefined : { body: { ...body } },
    providerOptions,
    profile,
    region,
  })

export const model: ProviderPackage.Model<Settings, BedrockConverse.OptionsInput> = (modelID, settings) =>
  fromSettings(settings).converse(modelID)
export const chatModel: ProviderPackage.Model<OpenAISettings, OpenAIOptionsInput> = (modelID, settings) =>
  fromSettings(settings).chat(modelID)
export const responsesModel: ProviderPackage.Model<OpenAISettings, OpenAIOptionsInput> = (modelID, settings) =>
  fromSettings(settings).responses(modelID)
export const messagesModel: ProviderPackage.Model<MessagesSettings, MessagesOptionsInput> = (modelID, settings) =>
  fromSettings(settings).messages(modelID)
