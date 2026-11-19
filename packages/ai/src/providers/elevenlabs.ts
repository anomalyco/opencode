import { Auth } from "../route/auth.js"
import { AuthOptions, type ProviderAuthOption } from "../route/auth-options.js"
import { MediaRoute } from "../route/media.js"
import { ProviderID, type ModelID, type ProviderOptions, type TransportOptions } from "../schema/index.js"
import type { ProviderPackage } from "../provider-package.js"
import { toConfig } from "./settings.js"
import { ElevenLabsSpeech } from "../protocols/elevenlabs-speech.js"
import { ElevenLabsTranscription } from "../protocols/elevenlabs-transcription.js"

export type { ElevenLabsOutputFormat, ElevenLabsSpeechOptions } from "../protocols/elevenlabs-speech.js"
export type { ElevenLabsTranscriptionOptions } from "../protocols/elevenlabs-transcription.js"

export const id = ProviderID.make("elevenlabs")

export type Config = TransportOptions &
  ProviderAuthOption<"optional"> & {
    readonly baseURL?: string
  }

const auth = (options: ProviderAuthOption<"optional">) =>
  AuthOptions.apiKey(options, "ELEVENLABS_API_KEY", Auth.header("xi-api-key"))

export type Settings = ProviderPackage.Settings & {
  readonly apiKey?: string | false
  readonly baseURL?: string
}

export const configure = (input: Config = {}) => {
  const media = MediaRoute.deployment(input, auth(input))
  const speech = (modelID: string | ModelID, providerOptions?: ProviderOptions) =>
    ElevenLabsSpeech.model({ ...media, id: modelID, providerOptions })
  const transcription = (modelID: string | ModelID, providerOptions?: ProviderOptions) =>
    ElevenLabsTranscription.model({ ...media, id: modelID, providerOptions })
  return {
    id,
    speech,
    transcription,
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

/** The package's `model` entrypoint serves speech models; `/transcription` serves transcription models. */
export const model = speechModel
