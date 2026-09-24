import { Auth } from "../route/auth.js"
import type { ProviderAuthOption } from "../route/auth-options.js"
import { HttpOptions, ProviderID, type ModelID } from "../schema/index.js"
import { AssemblyAITranscription, DEFAULT_BASE_URL } from "../protocols/assemblyai-transcription.js"

export type { AssemblyAITranscriptionOptions } from "../protocols/assemblyai-transcription.js"

export const id = ProviderID.make("assemblyai")
const baseURL = DEFAULT_BASE_URL

export type Config = ProviderAuthOption<"optional"> & {
  /** `https://api.eu.assemblyai.com` for the EU region. */
  readonly baseURL?: string
  readonly headers?: Record<string, string>
  readonly http?: HttpOptions.Input
}

// The key is the whole `authorization` value, without a scheme.
const auth = (options: ProviderAuthOption<"optional">) => {
  if ("auth" in options && options.auth) return options.auth
  return Auth.optional("apiKey" in options ? options.apiKey : undefined, "apiKey")
    .orElse(Auth.config("ASSEMBLYAI_API_KEY"))
    .pipe(Auth.header("authorization"))
}

export const configure = (input: Config = {}) => {
  const transcription = (modelID: string | ModelID) =>
    AssemblyAITranscription.model({
      id: modelID,
      auth: auth(input),
      baseURL: input.baseURL ?? baseURL,
      headers: input.headers,
      http: input.http === undefined ? undefined : HttpOptions.make(input.http),
    })
  return {
    id,
    transcription,
    configure,
  }
}

export const provider = configure()
export const transcription = provider.transcription
