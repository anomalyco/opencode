import { Auth } from "../route/auth.js"
import type { Route as RouteDef, RouteDefaultsInput } from "../route/client.js"
import { ProviderPackage } from "../provider-package.js"
import { OpenAIChat } from "../protocols/openai-chat.js"
import { OpenAIResponses } from "../protocols/openai-responses.js"
import { BedrockAuth, type Credentials } from "../protocols/utils/bedrock-auth.js"
import { ProviderID, type ModelID } from "../schema/index.js"
import { withOpenAIOptions, type OpenAIProviderOptionsInput } from "./openai-options.js"

export const id = ProviderID.make("amazon-bedrock")

export type Config = RouteDefaultsInput & {
  readonly apiKey?: string
  readonly baseURL?: string
  readonly credentials?: Credentials
  readonly region?: string
  readonly providerOptions?: OpenAIProviderOptionsInput
}

export interface Settings extends ProviderPackage.Settings {
  readonly apiKey?: string
  readonly auth?: "bearer" | "sigv4"
  readonly baseURL?: string
  readonly credentials?: Credentials
  readonly region?: string
  readonly providerOptions?: OpenAIProviderOptionsInput
}

const responsesRoute = OpenAIResponses.route.with({
  id: "bedrock-mantle-responses",
  provider: id,
})

const chatRoute = OpenAIChat.route.with({
  id: "bedrock-mantle-chat",
  provider: id,
})

export const routes = [responsesRoute, chatRoute]

const configuredRoute = <Body, Prepared>(route: RouteDef<Body, Prepared>, input: Config) => {
  const region = input.region ?? input.credentials?.region ?? "us-east-1"
  const credentials = input.credentials === undefined ? undefined : { ...input.credentials, region }
  return route.with({
    endpoint: { baseURL: input.baseURL ?? `https://bedrock-mantle.${region}.api.aws/v1` },
    auth:
      input.apiKey === undefined
        ? BedrockAuth.sigV4(credentials, { service: "bedrock-mantle", name: "Bedrock Mantle" })
        : Auth.bearer(input.apiKey),
  })
}

const defaults = (input: Config) => {
  const { apiKey: _, baseURL: _baseURL, credentials: _credentials, region: _region, ...rest } = input
  return rest
}

export const configure = (input: Config = {}) => {
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
    model: chat,
    chat,
    responses,
    configure,
  }
}

export const provider = configure()

const config = (input: ProviderPackage.ModelInput<Settings>): Config => {
  if (!input.credential && input.settings.auth === "bearer" && input.settings.apiKey === undefined)
    throw new Error("Amazon Bedrock Mantle bearer auth requires apiKey")
  if (!input.credential && input.settings.auth === "sigv4" && input.settings.apiKey !== undefined)
    throw new Error("Amazon Bedrock Mantle SigV4 auth does not accept apiKey")
  return {
    ...ProviderPackage.routeDefaults(input.defaults),
    apiKey: input.credential
      ? ProviderPackage.bearerCredentialValue(input.credential)
      : input.settings.auth === "sigv4"
        ? undefined
        : input.settings.apiKey,
    baseURL: input.settings.baseURL,
    credentials: input.settings.credentials,
    providerOptions: input.settings.providerOptions,
    region: input.settings.region,
  }
}

export const chatModel: ProviderPackage.Definition<Settings, OpenAIProviderOptionsInput>["model"] = (input) =>
  configure(config(input)).chat(input.id)
export const responsesModel: ProviderPackage.Definition<Settings, OpenAIProviderOptionsInput>["model"] = (input) =>
  configure(config(input)).responses(input.id)
export const model = chatModel
