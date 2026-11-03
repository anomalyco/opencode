import { Auth } from "../route/auth.js"
import { AuthOptions, type ProviderAuthOption } from "../route/auth-options.js"
import { MediaRoute } from "../route/media.js"
import { type HttpOptions, ProviderID, type ModelID } from "../schema/index.js"
import { ElevenLabsSpeech } from "../protocols/elevenlabs-speech.js"
import { ElevenLabsTranscription } from "../protocols/elevenlabs-transcription.js"

export type { ElevenLabsOutputFormat, ElevenLabsSpeechOptions } from "../protocols/elevenlabs-speech.js"
export type { ElevenLabsTranscriptionOptions } from "../protocols/elevenlabs-transcription.js"

export const id = ProviderID.make("elevenlabs")

export type Config = ProviderAuthOption<"optional"> & {
  readonly baseURL?: string
  readonly headers?: Record<string, string>
  readonly http?: HttpOptions.Input
}

const auth = (options: ProviderAuthOption<"optional">) =>
  AuthOptions.apiKey(options, "ELEVENLABS_API_KEY", Auth.header("xi-api-key"))

export const configure = (input: Config = {}) => {
  const media = MediaRoute.deployment(input, auth(input))
  const speech = (modelID: string | ModelID) => ElevenLabsSpeech.model({ ...media, id: modelID })
  const transcription = (modelID: string | ModelID) => ElevenLabsTranscription.model({ ...media, id: modelID })
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
