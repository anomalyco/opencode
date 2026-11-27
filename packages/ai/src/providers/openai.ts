import { AuthOptions, type ProviderAuthOption } from "../route/auth-options.js"
import { MediaRoute } from "../route/media.js"
import { Provider } from "../provider.js"
import { chatCompletions } from "./openai/chat.js"
import { responses } from "./openai/responses.js"
import { shared, type Settings } from "./openai/shared.js"
import {
  mergeTransport,
  ProviderID,
  ToolDefinition,
  type ModelID,
  type OpenString,
  type ProviderOptions,
  type RequestOptions,
} from "../schema/index.js"
import type { OpenAIProviderOptionsInput } from "./openai-options.js"
import { OpenAIImages } from "../protocols/openai-images.js"
import { OpenAISpeech } from "../protocols/openai-speech.js"
import { OpenAITranscription } from "../protocols/openai-transcription.js"
import { OpenAIDecisions, type OptionsInput as OpenAIDecisionOptionsInput } from "../protocols/openai-decisions.js"
import { OpenAIEmbeddings, type OptionsInput as OpenAIEmbeddingOptionsInput } from "../protocols/openai-embeddings.js"

export type { OpenAIOptionsInput, OpenAIResponseIncludable, OpenAIServiceTier } from "./openai-options.js"
export type { OpenAIImageOptions } from "../protocols/openai-images.js"
export type { OpenAISpeechOptions } from "../protocols/openai-speech.js"
export type { OpenAITranscriptionOptions } from "../protocols/openai-transcription.js"
export type { OptionsInput as OpenAIDecisionOptions } from "../protocols/openai-decisions.js"
export type { OptionsInput as OpenAIEmbeddingOptions } from "../protocols/openai-embeddings.js"

export const id = ProviderID.make("openai")

/** Connection settings for OpenAI's media models. Language models come from `openai`. */
export type Config = RequestOptions &
  ProviderAuthOption<"optional"> & {
    readonly baseURL?: string
    readonly queryParams?: Record<string, string>
    readonly providerOptions?: OpenAIProviderOptionsInput
  }

export interface ImageGenerationOptions {
  readonly action?: OpenString<"auto" | "generate" | "edit">
  readonly background?: OpenString<"auto" | "opaque" | "transparent">
  readonly inputFidelity?: OpenString<"low" | "high">
  readonly outputCompression?: number
  readonly outputFormat?: OpenString<"png" | "jpeg" | "webp">
  readonly partialImages?: number
  readonly quality?: OpenString<"auto" | "low" | "medium" | "high" | "standard" | "hd">
  readonly size?: OpenString<
    "auto" | "256x256" | "512x512" | "1024x1024" | "1536x1024" | "1024x1536" | "1792x1024" | "1024x1792"
  >
}

export const imageGeneration = (options: ImageGenerationOptions = {}) =>
  ToolDefinition.make({
    name: "image_generation",
    description: "Generate or edit an image using OpenAI's hosted image generation tool.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    native: {
      openai: {
        type: "image_generation",
        action: options.action,
        background: options.background,
        input_fidelity: options.inputFidelity,
        output_compression: options.outputCompression,
        output_format: options.outputFormat,
        partial_images: options.partialImages,
        quality: options.quality,
        size: options.size,
      },
    },
  })

export type { Settings } from "./openai/shared.js"

export const openai = Provider.make({ ...shared, apis: [responses, chatCompletions] })

const auth = (options: ProviderAuthOption<"optional">) => AuthOptions.bearer(options, "OPENAI_API_KEY")

export const media = (input: Config = {}) => {
  const media = MediaRoute.deployment(
    { ...mergeTransport(input, { http: { query: input.queryParams } }), baseURL: input.baseURL },
    auth(input),
  )
  // The ChatGPT backend (ChatGPT sign-in) rejects multipart image edits with "Unsupported content type".
  const imageInput = media.baseURL?.startsWith("https://chatgpt.com/") ? "json-edits" : undefined
  const image = (modelID: string | ModelID, providerOptions?: ProviderOptions) =>
    OpenAIImages.model({ ...media, id: modelID, providerOptions, imageInput })
  const speech = (modelID: string | ModelID) => OpenAISpeech.model({ ...media, id: modelID })
  const transcription = (modelID: string | ModelID) => OpenAITranscription.model({ ...media, id: modelID })
  const decisionRoute = OpenAIDecisions.route.with({
    endpoint: { baseURL: media.baseURL },
    auth: media.auth,
    ...media.transport,
  })
  const decision = (modelID: string | ModelID, providerOptions?: ProviderOptions) =>
    decisionRoute.model<OpenAIDecisionOptionsInput>({ id: modelID, providerOptions })
  const embeddingRoute = OpenAIEmbeddings.route.with({
    endpoint: { baseURL: media.baseURL },
    auth: media.auth,
    ...media.transport,
  })
  const embedding = (modelID: string | ModelID, providerOptions?: ProviderOptions) =>
    embeddingRoute.model<OpenAIEmbeddingOptionsInput>({ id: modelID, providerOptions })

  return {
    id,
    image,
    speech,
    transcription,
    decision,
    embedding,
  }
}

const defaultMedia = media()

const config = ({
  apiKey,
  baseURL,
  body,
  headers: given,
  organization,
  project,
  queryParams,
  ...providerOptions
}: Settings = {}): Config => {
  const headers = {
    ...(organization === undefined ? {} : { "OpenAI-Organization": organization }),
    ...(project === undefined ? {} : { "OpenAI-Project": project }),
    ...given,
  }
  return {
    apiKey,
    baseURL,
    headers: Object.keys(headers).length === 0 ? undefined : headers,
    http: body === undefined ? undefined : { body },
    providerOptions,
    queryParams,
  }
}

export const model = Provider.entrypoint<Settings, OpenAIProviderOptionsInput, typeof responses.compact>(openai)

export const chatModel = Provider.entrypoint<Settings, OpenAIProviderOptionsInput>(openai, "chat-completions")
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
export const image = defaultMedia.image
export const speech = defaultMedia.speech
export const transcription = defaultMedia.transcription
export const decision = defaultMedia.decision
export const embedding = defaultMedia.embedding
