import type { ProviderPackage } from "../provider-package.js"
import { OpenAIChat } from "../protocols/openai-chat.js"
import { OpenResponses } from "../protocols/open-responses.js"
import { AuthOptions, type ProviderAuthOption } from "../route/auth-options.js"
import { Route, type RouteDefaultsInput } from "../route/client.js"
import { Endpoint } from "../route/endpoint.js"
import { ProviderID, type ModelID } from "../schema/index.js"
import type { OpenAIProviderOptionsInput } from "./openai-options.js"
import type { OpenResponsesProviderOptionsInput } from "./open-responses-options.js"

export const id = ProviderID.make("fireworks")
const baseURL = "https://api.fireworks.ai/inference/v1"

export type Config = Omit<RouteDefaultsInput, "providerOptions"> &
  ProviderAuthOption<"optional"> & {
    readonly baseURL?: string
    readonly providerOptions?: OpenAIProviderOptionsInput | OpenResponsesProviderOptionsInput
  }

export type Settings<Options = OpenAIProviderOptionsInput> = ProviderPackage.Settings &
  Options & {
    readonly apiKey?: string | false
    readonly baseURL?: string
  }

export const route = Route.make({
  id: "fireworks-chat",
  provider: id,
  providerMetadataKey: "fireworks",
  protocol: OpenAIChat.protocol,
  endpoint: Endpoint.path("/chat/completions", { baseURL }),
  framing: OpenAIChat.framing,
})

const responsesRoute = Route.make({
  id: "fireworks-responses",
  provider: id,
  providerMetadataKey: "fireworks",
  protocol: OpenResponses.protocol,
  endpoint: Endpoint.path("/responses", { baseURL }),
  transport: OpenResponses.httpTransport,
  defaults: { providerOptions: { store: false, include: ["reasoning.encrypted_content"] } },
})

export const routes = [route, responsesRoute]

export const configure = (input: Config = {}) => {
  const { apiKey: _apiKey, auth: _auth, baseURL: endpoint, ...defaults } = input
  const options = {
    ...defaults,
    endpoint: { baseURL: endpoint ?? baseURL },
    auth: AuthOptions.bearer(input, "FIREWORKS_API_KEY"),
  }
  const configured = route.with(options)
  const configuredResponses = responsesRoute.with(options)
  return {
    id,
    model: (modelID: string | ModelID) =>
      configured.model<OpenAIProviderOptionsInput>({ id: modelID, compatibility: { supportsPromptCacheKey: true } }),
    responses: (modelID: string | ModelID) =>
      configuredResponses.model<OpenResponsesProviderOptionsInput>({ id: modelID }),
    configure,
  }
}

export const provider = configure()
export const responses = provider.responses

export const model: ProviderPackage.Model<Settings, OpenAIProviderOptionsInput> = (modelID, settings) =>
  configure(config(settings)).model(modelID)
export const responsesModel: ProviderPackage.Model<
  Settings<OpenResponsesProviderOptionsInput>,
  OpenResponsesProviderOptionsInput
> = (modelID, settings) => configure(config(settings)).responses(modelID)

function config({ apiKey, baseURL, body, headers, ...providerOptions }: Settings<Config["providerOptions"]> = {}) {
  return {
    apiKey,
    baseURL,
    headers,
    http: body === undefined ? undefined : { body },
    providerOptions,
  }
}

export * as Fireworks from "./fireworks.js"
