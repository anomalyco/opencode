import { Auth } from "../route/auth.js"
import { AuthOptions, type ProviderAuthOption } from "../route/auth-options.js"
import { MediaRoute } from "../route/media.js"
import { ProviderID, type ModelID, type ProviderOptions, type TransportOptions } from "../schema/index.js"
import type { ProviderPackage } from "../provider-package.js"
import { toConfig } from "./settings.js"
import { DeepgramSpeech } from "../protocols/deepgram-speech.js"
import { DeepgramTranscription } from "../protocols/deepgram-transcription.js"

export type { DeepgramEncoding, DeepgramSpeechOptions } from "../protocols/deepgram-speech.js"
export type { DeepgramTranscriptionOptions } from "../protocols/deepgram-transcription.js"

export const id = ProviderID.make("deepgram")

export type Config = TransportOptions &
  ProviderAuthOption<"optional"> & {
    readonly baseURL?: string
  }

const auth = (options: ProviderAuthOption<"optional">) =>
  AuthOptions.apiKey(options, "DEEPGRAM_API_KEY", Auth.scheme("Token"))

export type Settings = ProviderPackage.Settings & {
  readonly apiKey?: string | false
  readonly baseURL?: string
}

export const configure = (input: Config = {}) => {
  const media = MediaRoute.deployment(input, auth(input))
  return {
    id,
    speech: (modelID: string | ModelID, providerOptions?: ProviderOptions) =>
      DeepgramSpeech.model({ ...media, id: modelID, providerOptions }),
    transcription: (modelID: string | ModelID, providerOptions?: ProviderOptions) =>
      DeepgramTranscription.model({ ...media, id: modelID, providerOptions }),
    configure,
  }
}

export const provider = configure()
export const speech = provider.speech
export const transcription = provider.transcription

export const speechModel = (modelID: string, settings?: Settings) => {
  const input = toConfig(settings)
  return configure(input).speech(modelID, input.providerOptions)
}

export const transcriptionModel = (modelID: string, settings?: Settings) => {
  const input = toConfig(settings)
  return configure(input).transcription(modelID, input.providerOptions)
}

/** The package's `model` entrypoint serves transcription models; `/speech` serves speech models. */
export const model = transcriptionModel
