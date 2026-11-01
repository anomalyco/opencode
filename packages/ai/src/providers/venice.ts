import type { ProviderPackage } from "../provider-package.js"
import { VeniceChat } from "../protocols/venice-chat.js"
import { OpenAIChat } from "../protocols/openai-chat.js"
import { OpenAIImages, type OpenAIImageSizing } from "../protocols/openai-images.js"
import { ImageSizing } from "../protocols/utils/image-sizing.js"
import { OpenResponses } from "../protocols/open-responses.js"
import { AuthOptions, type ProviderAuthOption } from "../route/auth-options.js"
import { Route, type RouteDefaultsInput } from "../route/client.js"
import { Endpoint } from "../route/endpoint.js"
import { MediaRoute } from "../route/media.js"
import { HttpOptions, mergeHttpOptions, ProviderID, type ModelID, type ProviderOptions } from "../schema/index.js"
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
    readonly apiKey?: string | false
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

// Venice's OpenAI-compatible endpoint only takes these sizes.
const IMAGE_SIZES = [
  { width: 256, height: 256 },
  { width: 512, height: 512 },
  { width: 1024, height: 1024 },
  { width: 1536, height: 1024 },
  { width: 1024, height: 1536 },
  { width: 1792, height: 1024 },
  { width: 1024, height: 1792 },
]

const imageSizing: OpenAIImageSizing = (request) => {
  if (!ImageSizing.isRequested(request)) return undefined
  const size = ImageSizing.nearest(request, IMAGE_SIZES)
  return { size: `${size.width}x${size.height}` }
}

export const configure = (input: Config = {}) => {
  const { apiKey: _apiKey, auth: _auth, baseURL: endpoint, queryParams, ...rest } = input
  const auth = AuthOptions.bearer(input, "VENICE_API_KEY")
  const options = { ...rest, endpoint: { baseURL: endpoint ?? baseURL, query: queryParams }, auth }
  const chat = (modelID: string | ModelID) =>
    route.with(options).model<ChatOptionsInput>({ id: modelID, compatibility: VeniceChat.compatibility })
  const responses = (modelID: string | ModelID) =>
    responsesRoute.with(options).model<OpenResponsesProviderOptionsInput>({ id: modelID })
  const deployment = MediaRoute.deployment({ ...input, baseURL: endpoint ?? baseURL }, auth)
  const media = {
    ...deployment,
    http: mergeHttpOptions(
      deployment.http,
      queryParams === undefined ? undefined : new HttpOptions({ query: queryParams }),
    ),
  }
  const image = (modelID: string | ModelID, providerOptions?: ProviderOptions) =>
    OpenAIImages.model({
      ...media,
      id: modelID,
      provider: id,
      providerOptions,
      sizing: imageSizing,
      imageInput: "none",
    })
  return { id, model: chat, chat, responses, image, configure }
}

export const provider = configure()
export const chat = provider.chat
export const responses = provider.responses
export const image = provider.image
export const model: ProviderPackage.Model<Settings, ChatOptionsInput> = (modelID, settings) =>
  configure(config(settings)).model(modelID)
export const responsesModel: ProviderPackage.Model<
  Settings<OpenResponsesProviderOptionsInput>,
  OpenResponsesProviderOptionsInput
> = (modelID, settings) => configure(config(settings)).responses(modelID)
export const imageModel = (modelID: string, settings?: Settings) => {
  const input = config(settings)
  return configure(input).image(modelID, input.providerOptions)
}

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
