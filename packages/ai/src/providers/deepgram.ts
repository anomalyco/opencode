import { Auth } from "../route/auth.js"
import { AuthOptions, type ProviderAuthOption } from "../route/auth-options.js"
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

const auth = (options: ProviderAuthOption<"optional">) =>
  AuthOptions.apiKey(options, "DEEPGRAM_API_KEY", Auth.scheme("Token"))

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
