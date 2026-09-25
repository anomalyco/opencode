import { Auth } from "../route/auth.js"
import type { ProviderAuthOption } from "../route/auth-options.js"
import { MediaRoute } from "../route/media.js"
import { type HttpOptions, ProviderID, type ModelID } from "../schema/index.js"
import { DeepgramSpeech } from "../protocols/deepgram-speech.js"
import { DeepgramTranscription } from "../protocols/deepgram-transcription.js"

export type { DeepgramEncoding, DeepgramSpeechOptions } from "../protocols/deepgram-speech.js"
export type { DeepgramTranscriptionOptions } from "../protocols/deepgram-transcription.js"

export const id = ProviderID.make("deepgram")

export type Config = ProviderAuthOption<"optional"> & {
  readonly baseURL?: string
  readonly headers?: Record<string, string>
  readonly http?: HttpOptions.Input
}

const auth = (options: ProviderAuthOption<"optional">) => {
  if ("auth" in options && options.auth) return options.auth
  return Auth.optional("apiKey" in options ? options.apiKey : undefined, "apiKey")
    .orElse(Auth.config("DEEPGRAM_API_KEY"))
    .pipe(Auth.scheme("Token"))
}

export const configure = (input: Config = {}) => {
  const media = MediaRoute.deployment(input, auth(input))
  return {
    id,
    speech: (modelID: string | ModelID) => DeepgramSpeech.model({ ...media, id: modelID }),
    transcription: (modelID: string | ModelID) => DeepgramTranscription.model({ ...media, id: modelID }),
    configure,
  }
}

export const provider = configure()
export const speech = provider.speech
export const transcription = provider.transcription
