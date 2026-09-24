import { Auth } from "../route/auth.js"
import type { ProviderAuthOption } from "../route/auth-options.js"
import { HttpOptions, ProviderID, type ModelID } from "../schema/index.js"
import { DEFAULT_BASE_URL, ElevenLabsSpeech } from "../protocols/elevenlabs-speech.js"

export type { ElevenLabsOutputFormat, ElevenLabsSpeechOptions } from "../protocols/elevenlabs-speech.js"

export const id = ProviderID.make("elevenlabs")
const baseURL = DEFAULT_BASE_URL

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
  const speech = (modelID: string | ModelID) =>
    ElevenLabsSpeech.model({
      id: modelID,
      auth: auth(input),
      baseURL: input.baseURL ?? baseURL,
      headers: input.headers,
      http: input.http === undefined ? undefined : HttpOptions.make(input.http),
    })
  return {
    id,
    speech,
    configure,
  }
}

export const provider = configure()
export const speech = provider.speech
