import { Auth } from "../route/auth.js"
import type { ProviderAuthOption } from "../route/auth-options.js"
import { MediaRoute } from "../route/media.js"
import { type HttpOptions, ProviderID, type ModelID } from "../schema/index.js"
import { ElevenLabsSpeech } from "../protocols/elevenlabs-speech.js"

export type { ElevenLabsOutputFormat, ElevenLabsSpeechOptions } from "../protocols/elevenlabs-speech.js"

export const id = ProviderID.make("elevenlabs")

export type Config = ProviderAuthOption<"optional"> & {
  readonly baseURL?: string
  readonly headers?: Record<string, string>
  readonly http?: HttpOptions.Input
}

const auth = (options: ProviderAuthOption<"optional">) => {
  if ("auth" in options && options.auth) return options.auth
  return Auth.optional("apiKey" in options ? options.apiKey : undefined, "apiKey")
    .orElse(Auth.config("ELEVENLABS_API_KEY"))
    .pipe(Auth.header("xi-api-key"))
}

export const configure = (input: Config = {}) => {
  const media = MediaRoute.deployment(input, auth(input))
  const speech = (modelID: string | ModelID) => ElevenLabsSpeech.model({ ...media, id: modelID })
  return {
    id,
    speech,
    configure,
  }
}

export const provider = configure()
export const speech = provider.speech
