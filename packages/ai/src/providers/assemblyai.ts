import { Auth } from "../route/auth.js"
import { AuthOptions, type ProviderAuthOption } from "../route/auth-options.js"
import { MediaRoute } from "../route/media.js"
import { ProviderID, type ModelID, type ProviderOptions, type TransportOptions } from "../schema/index.js"
import type { ProviderPackage } from "../provider-package.js"
import { toConfig } from "./settings.js"
import { AssemblyAITranscription } from "../protocols/assemblyai-transcription.js"

export type { AssemblyAITranscriptionOptions } from "../protocols/assemblyai-transcription.js"

export const id = ProviderID.make("assemblyai")

export type Config = TransportOptions &
  ProviderAuthOption<"optional"> & {
    /** `https://api.eu.assemblyai.com` for the EU region. */
    readonly baseURL?: string
  }

// The key is the whole `authorization` value, without a scheme.
const auth = (options: ProviderAuthOption<"optional">) =>
  AuthOptions.apiKey(options, "ASSEMBLYAI_API_KEY", Auth.header("authorization"))

export type Settings = ProviderPackage.Settings & {
  readonly apiKey?: string | false
  readonly baseURL?: string
}

export const configure = (input: Config = {}) => {
  const media = MediaRoute.deployment(input, auth(input))
  const transcription = (modelID: string | ModelID, providerOptions?: ProviderOptions) =>
    AssemblyAITranscription.model({ ...media, id: modelID, providerOptions })
  return {
    id,
    transcription,
    configure,
  }
}

export const provider = configure()
export const transcription = provider.transcription

export const transcriptionModel = (modelID: string, settings?: Settings) => {
  const input = toConfig(settings)
  return configure(input).transcription(modelID, input.providerOptions)
}

export const model = transcriptionModel
