import { Auth } from "../route/auth.js"
import { AuthOptions, type ProviderAuthOption } from "../route/auth-options.js"
import { MediaRoute } from "../route/media.js"
import { type HttpOptions, ProviderID, type ModelID } from "../schema/index.js"
import { AssemblyAITranscription } from "../protocols/assemblyai-transcription.js"

export type { AssemblyAITranscriptionOptions } from "../protocols/assemblyai-transcription.js"

export const id = ProviderID.make("assemblyai")

export type Config = ProviderAuthOption<"optional"> & {
  /** `https://api.eu.assemblyai.com` for the EU region. */
  readonly baseURL?: string
  readonly headers?: Record<string, string>
  readonly http?: HttpOptions.Input
}

// The key is the whole `authorization` value, without a scheme.
const auth = (options: ProviderAuthOption<"optional">) =>
  AuthOptions.apiKey(options, "ASSEMBLYAI_API_KEY", Auth.header("authorization"))

export const configure = (input: Config = {}) => {
  const media = MediaRoute.deployment(input, auth(input))
  const transcription = (modelID: string | ModelID) => AssemblyAITranscription.model({ ...media, id: modelID })
  return {
    id,
    transcription,
    configure,
  }
}

export const provider = configure()
export const transcription = provider.transcription
