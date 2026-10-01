import { Route, type RouteDefaultsInput } from "../route/client.js"
import { Endpoint } from "../route/endpoint.js"
import type { ProviderPackage } from "../provider-package.js"
import { ProviderConfigurationError, ProviderID, type ModelID } from "../schema/index.js"
import * as BedrockConverse from "../protocols/bedrock-converse.js"
import type { BedrockCredentials } from "../protocols/bedrock-converse.js"
import { AnthropicMessages } from "../protocols/anthropic-messages.js"
import { OpenAIChat } from "../protocols/openai-chat.js"
import { OpenResponses } from "../protocols/open-responses.js"
import { BedrockAuth } from "../protocols/utils/bedrock-auth.js"
import { withOpenAIOptions, type OpenAIProviderOptionsInput } from "./openai-options.js"

export const id = ProviderID.make("amazon-bedrock")

export type Config = RouteDefaultsInput & {
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
  /** Override the computed `https://bedrock-runtime.<region>.amazonaws.com` URL. */
  readonly baseURL?: string
}

export interface Settings extends ProviderPackage.Settings {
  readonly apiKey?: string
  readonly auth?: "bearer" | "sigv4"
  readonly baseURL?: string
  readonly credentials?: BedrockCredentials
  readonly profile?: string
  readonly region?: string
  readonly topP?: number
  readonly thinking?: BedrockConverse.OptionsInput["thinking"]
}

export type OpenAISettings = Settings & OpenAIProviderOptionsInput
export type MessagesSettings = Settings & AnthropicMessages.ProviderOptionsInput

const responsesRoute = Route.make({
  id: "bedrock-responses",
  provider: id,
  providerMetadataKey: "bedrock",
  protocol: OpenResponses.protocol,
  endpoint: Endpoint.path(OpenResponses.PATH),
  transport: OpenResponses.httpTransport,
  defaults: { providerOptions: { store: false, include: ["reasoning.encrypted_content"] } },
})

const chatRoute = OpenAIChat.route.with({
  id: "bedrock-chat",
  provider: id,
  providerMetadataKey: "bedrock",
})

const messagesRoute = AnthropicMessages.route.with({
  id: "bedrock-messages",
  provider: id,
  providerMetadataKey: "bedrock",
})

export const routes = [BedrockConverse.route, responsesRoute, chatRoute, messagesRoute]

const bedrockBaseURL = (region: string) => `https://bedrock-runtime.${region}.amazonaws.com`

const configuredRoutes = (input: Config) => {
  const { apiKey, auth: mode, credentials, profile, region, baseURL, ...rest } = input
  if (mode === "bearer" && apiKey === undefined && process.env.AWS_BEARER_TOKEN_BEDROCK === undefined)
    throw new ProviderConfigurationError({ provider: id, message: "Amazon Bedrock bearer auth requires apiKey" })
  if (mode === "sigv4" && apiKey !== undefined)
    throw new ProviderConfigurationError({ provider: id, message: "Amazon Bedrock SigV4 auth does not accept apiKey" })
  const resolvedRegion = BedrockAuth.resolveRegion(input)
  const auth = BedrockAuth.resolveAuth({ apiKey, credentials, profile }, resolvedRegion, { mode })
  const root = baseURL ?? bedrockBaseURL(resolvedRegion)
  const defaults = {
    ...rest,
    provider: id,
    providerMetadataKey: "bedrock",
  }
  return {
    converse: BedrockConverse.route.with({ ...defaults, endpoint: { baseURL: root }, auth }),
    responses: responsesRoute.with({
      ...defaults,
      endpoint: { baseURL: `${root}/openai/v1` },
      auth,
    }),
    chat: chatRoute.with({ ...defaults, endpoint: { baseURL: `${root}/openai/v1` }, auth }),
    messages: messagesRoute.with({
      ...defaults,
      endpoint: { baseURL: `${root}/anthropic/v1` },
      auth: BedrockAuth.resolveAuth({ apiKey, credentials, profile }, resolvedRegion, {
        apiKeyHeader: "x-api-key",
        mode,
      }),
    }),
  }
}

export const configure = (input: Config = {}) => {
  const route = configuredRoutes(input)
  const {
    apiKey: _,
    auth: _auth,
    credentials: _credentials,
    profile: _profile,
    region: _region,
    baseURL: _baseURL,
    ...rest
  } = input
  return {
    id,
    model: (modelID: string | ModelID) => route.converse.model({ id: modelID }),
    converse: (modelID: string | ModelID) => route.converse.model({ id: modelID }),
    responses: (modelID: string | ModelID) =>
      route.responses.with(withOpenAIOptions(modelID, rest)).model<OpenAIProviderOptionsInput>({ id: modelID }),
    chat: (modelID: string | ModelID) =>
      route.chat.with(withOpenAIOptions(modelID, rest)).model<OpenAIProviderOptionsInput>({ id: modelID }),
    messages: (modelID: string | ModelID) =>
      route.messages.model<AnthropicMessages.ProviderOptionsInput>({ id: modelID }),
    configure,
  }
}

export const provider = configure()
export const model: ProviderPackage.Definition<Settings>["model"] = (modelID, settings) =>
  configure({
    apiKey: settings.apiKey,
    auth: settings.auth,
    baseURL: settings.baseURL,
    credentials: settings.credentials,
    generation: settings.topP === undefined ? undefined : { topP: settings.topP },
    headers: settings.headers === undefined ? undefined : { ...settings.headers },
    http: settings.body === undefined ? undefined : { body: { ...settings.body } },
    providerOptions: settings.thinking === undefined ? undefined : { thinking: settings.thinking },
    profile: settings.profile,
    region: settings.region,
  }).model(modelID)

const openAIModel = (modelID: string | ModelID, settings: OpenAISettings, api: "chat" | "responses") => {
  const { apiKey, auth, baseURL, body, credentials, headers, profile, region, topP, ...providerOptions } = settings
  const provider = configure({
    apiKey,
    auth,
    baseURL,
    credentials,
    generation: topP === undefined ? undefined : { topP },
    headers: headers === undefined ? undefined : { ...headers },
    http: body === undefined ? undefined : { body: { ...body } },
    profile,
    providerOptions,
    region,
  })
  return provider[api](modelID)
}

export const responsesModel: ProviderPackage.Definition<OpenAISettings, OpenAIProviderOptionsInput>["model"] = (
  modelID,
  settings,
) => openAIModel(modelID, settings, "responses")

export const chatModel: ProviderPackage.Definition<OpenAISettings, OpenAIProviderOptionsInput>["model"] = (
  modelID,
  settings,
) => openAIModel(modelID, settings, "chat")

export const messagesModel: ProviderPackage.Definition<
  MessagesSettings,
  AnthropicMessages.ProviderOptionsInput
>["model"] = (modelID, settings) => {
  const { apiKey, auth, baseURL, body, credentials, headers, profile, region, topP, ...providerOptions } = settings
  return configure({
    apiKey,
    auth,
    baseURL,
    credentials,
    generation: topP === undefined ? undefined : { topP },
    headers: headers === undefined ? undefined : { ...headers },
    http: body === undefined ? undefined : { body: { ...body } },
    profile,
    providerOptions,
    region,
  }).messages(modelID)
}
