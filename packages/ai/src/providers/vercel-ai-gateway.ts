import { OpenAIDecisions } from "../protocols/openai-decisions.js"
import { OpenAIEmbeddings } from "../protocols/openai-embeddings.js"
import { OpenAIImages, type OpenAIImageSizing } from "../protocols/openai-images.js"
import { XAIImages } from "../protocols/xai-images.js"
import type { ProviderPackage } from "../provider-package.js"
import { Provider } from "../provider.js"
import { AuthOptions, type ProviderAuthOption } from "../route/auth-options.js"
import { MediaRoute } from "../route/media.js"
import { mergeTransport, ProviderID, type ModelID, type ProviderOptions, type RequestOptions } from "../schema/index.js"
import { chatCompletions } from "./vercel-ai-gateway/chat.js"
import { messages } from "./vercel-ai-gateway/messages.js"
import { responses } from "./vercel-ai-gateway/responses.js"
import { shared, type ProviderOptionsInput, type Settings } from "./vercel-ai-gateway/shared.js"
import { toConfig } from "./settings.js"

export type { GatewayOptions, ProviderOptionsInput, Settings } from "./vercel-ai-gateway/shared.js"
export { model as messagesModel } from "./vercel-ai-gateway/messages.js"
export { model as responsesModel } from "./vercel-ai-gateway/responses.js"
export { model as chatModel } from "./vercel-ai-gateway/chat.js"

export const id = ProviderID.make("vercel-ai-gateway")

/** Connection settings for the Gateway's media models. Language models come from `vercelAIGateway`. */
export type Config = Omit<RequestOptions, "providerOptions"> &
  ProviderAuthOption<"optional"> & {
    readonly baseURL?: string
    readonly providerOptions?: ProviderOptionsInput
  }

export const vercelAIGateway = Provider.make({ ...shared, apis: [messages, responses, chatCompletions] })

// Each family uses the API whose Gateway translation carries its reasoning state across turns.
const apiFor = (modelID: string) => {
  if (/^(openai\/gpt-|spacexai\/grok-)/.test(modelID)) return "responses"
  if (modelID.startsWith("meta/muse-")) return "chat-completions"
  return "messages"
}

export const model: ProviderPackage.Model<Settings, ProviderOptionsInput> = (modelID, ...settings) =>
  Provider.entrypoint<Settings, ProviderOptionsInput>(vercelAIGateway, apiFor(modelID))(modelID, ...settings)

// The Gateway passes `size` through to most image models, but Grok ignores it and renders 1024x1024; it only reads
// sizing from `providerOptions.xai`.
const imageSizing: OpenAIImageSizing = (request) => {
  if (!/^(spacexai|xai)\//.test(request.model.id)) return OpenAIImages.pixelSize(request)
  if (request.aspect === undefined && request.resolution === undefined) return undefined
  return { providerOptions: { xai: { aspect_ratio: request.aspect, resolution: XAIImages.resolution(request) } } }
}

export const media = (input: Config = {}) => {
  const auth = AuthOptions.bearer(input, ["AI_GATEWAY_API_KEY", "VERCEL_OIDC_TOKEN"])
  const baseURL = input.baseURL ?? shared.baseURL
  const deployment = MediaRoute.deployment({ ...input, baseURL }, auth)
  const decisionRoute = OpenAIDecisions.route.with({
    provider: id,
    endpoint: { baseURL },
    auth,
    ...mergeTransport(input),
  })
  const embeddingRoute = OpenAIEmbeddings.route.with({
    provider: id,
    endpoint: { baseURL },
    auth,
    ...mergeTransport(input),
  })
  return {
    image: (modelID: string | ModelID, providerOptions?: ProviderOptions) =>
      OpenAIImages.model({ ...deployment, id: modelID, provider: id, providerOptions, sizing: imageSizing }),
    decision: (modelID: string | ModelID, providerOptions?: ProviderOptions) =>
      decisionRoute.model({ id: modelID, providerOptions }),
    embedding: (modelID: string | ModelID, providerOptions?: ProviderOptions) =>
      embeddingRoute.model({ id: modelID, providerOptions }),
  }
}

const defaultMedia = media()

export const decision = defaultMedia.decision
export const embedding = defaultMedia.embedding
export const image = defaultMedia.image

export const imageModel = (modelID: string, settings?: Settings) => {
  const input = toConfig(settings)
  return media(input).image(modelID, input.providerOptions)
}
export const decisionModel = (modelID: string, settings?: Settings) => {
  const input = toConfig(settings)
  return media(input).decision(modelID, input.providerOptions)
}
export const embeddingModel = (modelID: string, settings?: Settings) => {
  const input = toConfig(settings)
  return media(input).embedding(modelID, input.providerOptions)
}

export * as VercelAIGateway from "./vercel-ai-gateway.js"
