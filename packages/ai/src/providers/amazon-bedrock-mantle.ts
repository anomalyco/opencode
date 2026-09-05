import { Route, type RouteDefaultsInput } from "../route/client.js"
import type { ProviderPackage } from "../provider-package.js"
import { OpenAIChat } from "../protocols/openai-chat.js"
import { OpenAIResponses } from "../protocols/openai-responses.js"
import { BedrockAuth, type Credentials } from "../protocols/utils/bedrock-auth.js"
import { ProviderID, type ModelID } from "../schema/index.js"
import { withOpenAIOptions, type OpenAIProviderOptionsInput } from "./openai-options.js"

export const id = ProviderID.make("amazon-bedrock")

export type Config = RouteDefaultsInput & {
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
  readonly providerOptions?: OpenAIProviderOptionsInput
}

export interface Settings extends ProviderPackage.Settings {
  readonly apiKey?: string
  readonly auth?: "bearer" | "sigv4"
  readonly baseURL?: string
  readonly credentials?: Credentials
  readonly profile?: string
  readonly region?: string
  readonly topP?: number
  readonly providerOptions?: OpenAIProviderOptionsInput
}

const responsesRoute = Route.make({
  id: "bedrock-mantle-responses",
  provider: id,
  providerMetadataKey: "mantle",
  protocol: OpenAIResponses.protocol,
  endpoint: OpenAIResponses.route.endpoint,
  auth: OpenAIResponses.route.auth,
  transport: OpenAIResponses.httpTransport,
  defaults: OpenAIResponses.route.defaults,
})

const chatRoute = OpenAIChat.route.with({
  id: "bedrock-mantle-chat",
  provider: id,
  providerMetadataKey: "mantle",
})

export const routes = [responsesRoute, chatRoute]

const configuredRoute = <Body, Prepared>(route: Route<Body, Prepared>, input: Config) => {
  const region = BedrockAuth.resolveRegion(input)
  return route.with({
    endpoint: { baseURL: input.baseURL ?? `https://bedrock-mantle.${region}.api.aws/v1` },
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
    throw new Error("Amazon Bedrock Mantle bearer auth requires apiKey")
  if (input.auth === "sigv4" && input.apiKey !== undefined)
    throw new Error("Amazon Bedrock Mantle SigV4 auth does not accept apiKey")
  const configuredResponsesRoute = configuredRoute(responsesRoute, input)
  const configuredChatRoute = configuredRoute(chatRoute, input)
  const modelDefaults = defaults(input)
  const responses = (modelID: string | ModelID) =>
    configuredResponsesRoute
      .with(withOpenAIOptions(modelID, modelDefaults))
      .model<OpenAIProviderOptionsInput>({ id: modelID })
  const chat = (modelID: string | ModelID) =>
    configuredChatRoute
      .with(withOpenAIOptions(modelID, modelDefaults))
      .model<OpenAIProviderOptionsInput>({ id: modelID })

  return {
    id,
    model: responses,
    chat,
    responses,
    configure,
  }
}

export const provider = configure()

const fromSettings = (settings: Settings) =>
  configure({
    apiKey: settings.apiKey,
    auth: settings.auth,
    baseURL: settings.baseURL,
    credentials: settings.credentials,
    generation: settings.topP === undefined ? undefined : { topP: settings.topP },
    headers: settings.headers === undefined ? undefined : { ...settings.headers },
    http: settings.body === undefined ? undefined : { body: { ...settings.body } },
    profile: settings.profile,
    providerOptions: settings.providerOptions,
    region: settings.region,
  })

export const chatModel: ProviderPackage.Definition<Settings, OpenAIProviderOptionsInput>["model"] = (
  modelID,
  settings,
) => fromSettings(settings).chat(modelID)
export const responsesModel: ProviderPackage.Definition<Settings, OpenAIProviderOptionsInput>["model"] = (
  modelID,
  settings,
) => fromSettings(settings).responses(modelID)
export const model = responsesModel
