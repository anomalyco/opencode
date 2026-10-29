import type { ProviderPackage } from "../provider-package.js"
import { VeniceChat } from "../protocols/venice-chat.js"
import { OpenAIChat } from "../protocols/openai-chat.js"
import { OpenResponses } from "../protocols/open-responses.js"
import { AuthOptions, type ProviderAuthOption } from "../route/auth-options.js"
import { Route, type RouteDefaultsInput } from "../route/client.js"
import { Endpoint } from "../route/endpoint.js"
import { ProviderID, type ModelID } from "../schema/index.js"
import type { OpenResponsesProviderOptionsInput } from "./open-responses-options.js"

export const id = ProviderID.make("venice")
export type ChatOptionsInput = VeniceChat.OptionsInput
export type Config = Omit<RouteDefaultsInput, "providerOptions"> &
  ProviderAuthOption<"optional"> & {
    readonly baseURL?: string
    readonly queryParams?: Readonly<Record<string, string>>
    readonly providerOptions?: ChatOptionsInput | OpenResponsesProviderOptionsInput
  }
export type Settings<Options = ChatOptionsInput> = ProviderPackage.Settings &
  Options & {
    readonly apiKey?: string
    readonly baseURL?: string
    readonly queryParams?: Readonly<Record<string, string>>
  }

const baseURL = "https://api.venice.ai/api/v1"

const route = Route.make({
  id: "venice-chat",
  provider: id,
  providerMetadataKey: "venice",
  protocol: VeniceChat.protocol,
  endpoint: Endpoint.path("/chat/completions", { baseURL }),
  framing: OpenAIChat.framing,
})
const responsesRoute = Route.make({
  id: "venice-responses",
  provider: id,
  providerMetadataKey: "venice",
  protocol: OpenResponses.protocol,
  endpoint: Endpoint.path("/responses", { baseURL }),
  transport: OpenResponses.httpTransport,
  defaults: { providerOptions: { store: false, include: ["reasoning.encrypted_content"] } },
})
export const routes = [route, responsesRoute]

export const configure = (input: Config = {}) => {
  const { apiKey: _apiKey, auth: _auth, baseURL: endpoint, queryParams, ...rest } = input
  const options = {
    ...rest,
    endpoint: { baseURL: endpoint ?? baseURL, query: queryParams },
    auth: AuthOptions.bearer(input, "VENICE_API_KEY"),
  }
  const chat = (modelID: string | ModelID) =>
    route.with(options).model<ChatOptionsInput>({ id: modelID, compatibility: VeniceChat.compatibility })
  const responses = (modelID: string | ModelID) =>
    responsesRoute.with(options).model<OpenResponsesProviderOptionsInput>({ id: modelID })
  return { id, model: chat, chat, responses, configure }
}

export const provider = configure()
export const chat = provider.chat
export const responses = provider.responses
export const model: ProviderPackage.Model<Settings, ChatOptionsInput> = (modelID, settings) =>
  configure(config(settings)).model(modelID)
export const responsesModel: ProviderPackage.Model<
  Settings<OpenResponsesProviderOptionsInput>,
  OpenResponsesProviderOptionsInput
> = (modelID, settings) => configure(config(settings)).responses(modelID)

function config({
  apiKey,
  baseURL,
  queryParams,
  body,
  headers,
  ...providerOptions
}: Settings<Config["providerOptions"]> = {}) {
  return {
    apiKey,
    baseURL,
    queryParams,
    headers,
    http: body === undefined ? undefined : { body },
    providerOptions,
  }
}

export * as Venice from "./venice.js"
