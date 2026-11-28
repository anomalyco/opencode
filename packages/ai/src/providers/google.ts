import { AuthOptions, type ProviderAuthOption } from "../route/auth-options.js"
import { Auth } from "../route/auth.js"
import { MediaRoute } from "../route/media.js"
import { Provider } from "../provider.js"
import { mergeTransport, ProviderID, type ModelID, type ProviderOptions, type RequestOptions } from "../schema/index.js"
import { Gemini } from "../protocols/gemini.js"
import {
  GoogleEmbedContent,
  type OptionsInput as GoogleEmbeddingOptionsInput,
} from "../protocols/google-embed-content.js"
import { GoogleDecisions } from "../protocols/google-decisions.js"
import { GoogleInteractions } from "../protocols/google-interactions.js"
import { GoogleInteractionsVideo } from "../protocols/google-interactions-video.js"
import { GoogleImages } from "../protocols/google-images.js"
import { GoogleSpeech } from "../protocols/google-speech.js"
import { GoogleTranscription } from "../protocols/google-transcription.js"
import { shared, type ConnectionSettings } from "./google/shared.js"
import { toConfig } from "./settings.js"

export type { OptionsInput as GoogleEmbeddingOptions } from "../protocols/google-embed-content.js"
export type { GoogleImageOptions } from "../protocols/google-images.js"
export type { GoogleVideoOptions } from "../protocols/google-interactions-video.js"
export type { GoogleSpeechOptions } from "../protocols/google-speech.js"
export type { GoogleTranscriptionOptions } from "../protocols/google-transcription.js"
export type GeminiOptionsInput = Gemini.OptionsInput
export type GeminiProviderOptionsInput = Gemini.ProviderOptionsInput
export type GoogleInteractionsOptionsInput = GoogleInteractions.OptionsInput
export type GoogleDecisionsOptionsInput = GoogleDecisions.OptionsInput

export const id = ProviderID.make("google")

/** Connection settings for Google's media models. Language models come from `google`. */
export type Config = RequestOptions &
  ProviderAuthOption<"optional"> & {
    readonly baseURL?: string
  }

export type Settings = ConnectionSettings & Gemini.ProviderOptionsInput

export const google = Provider.make({ ...shared, apis: [Gemini.api, GoogleInteractions.api] })

export const model = Provider.entrypoint<Settings, Gemini.ProviderOptionsInput>(google)

const auth = (options: ProviderAuthOption<"optional">) =>
  AuthOptions.apiKey(options, "GOOGLE_GENERATIVE_AI_API_KEY", Auth.header("x-goog-api-key"))

export const media = (input: Config = {}) => {
  const media = MediaRoute.deployment(input, auth(input))
  const embeddingRoute = GoogleEmbedContent.route.with({
    provider: id,
    endpoint: { baseURL: input.baseURL },
    auth: auth(input),
    ...mergeTransport(input),
  })
  return {
    id,
    image: (modelID: string | ModelID, providerOptions?: ProviderOptions) =>
      GoogleImages.model({ ...media, id: modelID, providerOptions }),
    video: (modelID: string | ModelID, providerOptions?: ProviderOptions) =>
      GoogleInteractionsVideo.model({ ...media, id: modelID, providerOptions }),
    speech: (modelID: string | ModelID) => GoogleSpeech.model({ ...media, id: modelID }),
    transcription: (modelID: string | ModelID) => GoogleTranscription.model({ ...media, id: modelID }),
    embedding: (modelID: string | ModelID, providerOptions?: ProviderOptions) =>
      embeddingRoute.model<GoogleEmbeddingOptionsInput>({ id: modelID, providerOptions }),
    decision: (modelID: string | ModelID, providerOptions?: ProviderOptions) =>
      GoogleDecisions.route
        .with({
          endpoint: { baseURL: media.baseURL },
          auth: media.auth,
          ...media.transport,
        })
        .model<GoogleDecisions.OptionsInput>({ id: modelID, providerOptions }),
  }
}

const defaultMedia = media()

export const imageModel = (modelID: string, settings?: Settings) => {
  const input = toConfig(settings)
  return media(input).image(modelID, input.providerOptions)
}
export const videoModel = (modelID: string, settings?: Settings) => {
  const input = toConfig(settings)
  return media(input).video(modelID, input.providerOptions)
}
export const embeddingModel = (modelID: string, settings?: Settings) => {
  const input = toConfig(settings)
  return media(input).embedding(modelID, input.providerOptions)
}
export const decisionModel = (modelID: string, settings?: Settings) => {
  const input = toConfig(settings)
  return media(input).decision(modelID, input.providerOptions)
}

export const image = defaultMedia.image
export const video = defaultMedia.video
export const embedding = defaultMedia.embedding
export const speech = defaultMedia.speech
export const transcription = defaultMedia.transcription
export const decision = defaultMedia.decision
