import { Auth } from "../route/auth.js"
import { AuthOptions, type ProviderAuthOption } from "../route/auth-options.js"
import { MediaRoute } from "../route/media.js"
import type { ProviderPackage } from "../provider-package.js"
import { ProviderID, type ModelID, type ProviderOptions, type RequestOptions } from "../schema/index.js"
import { Gemini } from "../protocols/gemini.js"
import {
  GoogleEmbedContent,
  type OptionsInput as GoogleEmbeddingOptionsInput,
} from "../protocols/google-embed-content.js"
import { GoogleDecisions } from "../protocols/google-decisions.js"
import { GoogleInteractions } from "../protocols/google-interactions.js"
import { GoogleImages } from "../protocols/google-images.js"
import { GoogleSpeech } from "../protocols/google-speech.js"
import { GoogleTranscription } from "../protocols/google-transcription.js"
import { GoogleVideo } from "../protocols/google-video.js"
import { toConfig } from "./settings.js"

export type { OptionsInput as GoogleEmbeddingOptions } from "../protocols/google-embed-content.js"
export type { GoogleImageOptions } from "../protocols/google-images.js"
export type { GoogleSpeechOptions } from "../protocols/google-speech.js"
export type { GoogleTranscriptionOptions } from "../protocols/google-transcription.js"
export type { GoogleVideoOptions } from "../protocols/google-video.js"
export type GeminiOptionsInput = Gemini.OptionsInput
export type GeminiProviderOptionsInput = Gemini.ProviderOptionsInput
export type GoogleInteractionsOptionsInput = GoogleInteractions.OptionsInput
export type GoogleDecisionsOptionsInput = GoogleDecisions.OptionsInput

export const id = ProviderID.make("google")

export const routes = [Gemini.route, GoogleInteractions.route]

export type Config = RequestOptions &
  ProviderAuthOption<"optional"> & {
    readonly baseURL?: string
    readonly providerOptions?: Gemini.ProviderOptionsInput & GoogleInteractions.ProviderOptionsInput
  }

export type Settings = ProviderPackage.Settings &
  Gemini.ProviderOptionsInput & {
    readonly apiKey?: string | false
    readonly baseURL?: string
  }

const auth = (options: ProviderAuthOption<"optional">) =>
  AuthOptions.apiKey(options, "GOOGLE_GENERATIVE_AI_API_KEY", Auth.header("x-goog-api-key"))

const configuredRoute = (input: Config) => {
  const { apiKey: _, auth: _auth, baseURL, ...rest } = input
  return Gemini.route.with({ ...rest, endpoint: { baseURL }, auth: auth(input) })
}

const interactionsRoute = (input: Config) => {
  const { apiKey: _, auth: _auth, baseURL, ...rest } = input
  return GoogleInteractions.route.with({ ...rest, endpoint: { baseURL }, auth: auth(input) })
}

export const configure = (input: Config = {}) => {
  const route = configuredRoute(input)
  const media = MediaRoute.deployment(input, auth(input))
  const gemini = (modelID: string | ModelID) => route.model<Gemini.ProviderOptionsInput>({ id: modelID })
  const embeddingRoute = GoogleEmbedContent.route.with({
    provider: id,
    endpoint: { baseURL: input.baseURL },
    auth: auth(input),
    headers: input.headers,
    http: input.http,
  })
  return {
    id,
    model: gemini,
    gemini,
    interactions: (modelID: string | ModelID) =>
      interactionsRoute(input).model<GoogleInteractions.ProviderOptionsInput>({ id: modelID }),
    image: (modelID: string | ModelID, providerOptions?: ProviderOptions) =>
      GoogleImages.model({ ...media, id: modelID, providerOptions }),
    video: (modelID: string | ModelID) => GoogleVideo.model({ ...media, id: modelID }),
    speech: (modelID: string | ModelID) => GoogleSpeech.model({ ...media, id: modelID }),
    transcription: (modelID: string | ModelID) => GoogleTranscription.model({ ...media, id: modelID }),
    embedding: (modelID: string | ModelID, providerOptions?: ProviderOptions) =>
      embeddingRoute.model<GoogleEmbeddingOptionsInput>({ id: modelID, providerOptions }),
    decision: (modelID: string | ModelID, providerOptions?: ProviderOptions) =>
      GoogleDecisions.route
        .with({ endpoint: { baseURL: media.baseURL }, auth: media.auth, headers: media.headers, http: media.http })
        .model<GoogleDecisions.OptionsInput>({ id: modelID, providerOptions }),
    configure,
  }
}

export const provider = configure()
export const model: ProviderPackage.Model<Settings, Gemini.ProviderOptionsInput> = (modelID, settings) =>
  configure(toConfig(settings)).model(modelID)
export const imageModel = (modelID: string, settings?: Settings) => {
  const input = toConfig(settings)
  return configure(input).image(modelID, input.providerOptions)
}
export const embeddingModel = (modelID: string, settings?: Settings) => {
  const input = toConfig(settings)
  return configure(input).embedding(modelID, input.providerOptions)
}
export const decisionModel = (modelID: string, settings?: Settings) => {
  const input = toConfig(settings)
  return configure(input).decision(modelID, input.providerOptions)
}

export const image = provider.image
export const embedding = provider.embedding
export const gemini = provider.gemini
export const interactions = provider.interactions
export const video = provider.video
export const speech = provider.speech
export const transcription = provider.transcription
export const decision = provider.decision
