import { OpenAIChat } from "../protocols/openai-chat.js"
import { OpenAIEmbeddings } from "../protocols/openai-embeddings.js"
import { OpenAIImages } from "../protocols/openai-images.js"
import { SystemOne } from "../protocols/system-one.js"
import { cacheControl } from "../protocols/utils/cache.js"
import { Provider } from "../provider.js"
import { AuthOptions, type ProviderAuthOption } from "../route/auth-options.js"
import { MediaRoute } from "../route/media.js"
import { mergeTransport, ProviderID, type ModelID, type ProviderOptions, type RequestOptions } from "../schema/index.js"
import type { OpenAIProviderOptionsInput } from "./openai-options.js"
import type { OpenResponsesProviderOptionsInput } from "./open-responses-options.js"
import { responses } from "./digitalocean/responses.js"
import { baseURL, env, shared, type Settings as SharedSettings } from "./digitalocean/shared.js"

const id = ProviderID.make("digitalocean")

/** Connection settings for DigitalOcean's media models. Language models come from `digitalocean`. */
export type Config = Omit<RequestOptions, "providerOptions"> &
  ProviderAuthOption<"optional"> & {
    readonly baseURL?: string
    readonly providerOptions?: OpenAIProviderOptionsInput | OpenResponsesProviderOptionsInput
  }

export type Settings<Options = OpenAIProviderOptionsInput> = SharedSettings<Options>

export const chatCompletions = OpenAIChat.api
  .extend({
    id: "digitalocean-chat",
    body: (request) => OpenAIChat.fromRequest(request, { cacheControl: cacheControl() }),
  })
  .configure({ capabilities: { cache: { markers: true, promptCacheKey: true } } })

export const digitalocean = Provider.make({ ...shared, apis: [chatCompletions, responses] })

export const media = (input: Config = {}) => {
  const auth = AuthOptions.bearer(input, env)
  const endpoint = { baseURL: input.baseURL ?? baseURL }
  const decisionRoute = SystemOne.route.with({
    provider: id,
    providerMetadataKey: "digitalocean",
    endpoint,
    auth,
    // DigitalOcean serves TypeSafe's Jev, which needs this header for images.
    ...mergeTransport({ headers: { "TypeSafe-Danger-Zone-Images": "true" } }, input),
  })
  const deployment = MediaRoute.deployment({ ...input, baseURL: endpoint.baseURL }, auth)
  const embeddingRoute = OpenAIEmbeddings.route.with({
    provider: id,
    endpoint,
    auth,
    ...mergeTransport(input),
  })
  return {
    id,
    decision: (modelID: string | ModelID, providerOptions?: ProviderOptions) =>
      decisionRoute.model({ id: modelID, providerOptions }),
    image: (modelID: string | ModelID, providerOptions?: ProviderOptions) =>
      OpenAIImages.model({ ...deployment, id: modelID, provider: id, providerOptions }),
    embedding: (modelID: string | ModelID, providerOptions?: ProviderOptions) =>
      embeddingRoute.model({ id: modelID, providerOptions }),
  }
}

const defaultMedia = media()
export const decision = defaultMedia.decision
export const embedding = defaultMedia.embedding
export const image = defaultMedia.image

export const model = Provider.entrypoint<Settings, OpenAIProviderOptionsInput>(digitalocean)
export const responsesModel = Provider.entrypoint<
  Settings<OpenResponsesProviderOptionsInput>,
  OpenResponsesProviderOptionsInput
>(digitalocean, "responses")
export const imageModel = (modelID: string, settings?: Settings) => {
  const input = config(settings)
  return media(input).image(modelID, input.providerOptions)
}
export const decisionModel = (modelID: string, settings?: Settings) => {
  const input = config(settings)
  return media(input).decision(modelID, input.providerOptions)
}
export const embeddingModel = (modelID: string, settings?: Settings) => {
  const input = config(settings)
  return media(input).embedding(modelID, input.providerOptions)
}

function config({ apiKey, baseURL, body, headers, ...providerOptions }: Settings<Config["providerOptions"]> = {}) {
  return {
    apiKey,
    baseURL,
    headers,
    http: { body },
    providerOptions,
  }
}

export * as DigitalOcean from "./digitalocean.js"
