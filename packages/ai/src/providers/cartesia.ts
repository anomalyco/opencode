import { AuthOptions, type ProviderAuthOption } from "../route/auth-options.js"
import { MediaRoute } from "../route/media.js"
import { ProviderID, type ModelID, type ProviderOptions, type TransportOptions } from "../schema/index.js"
import type { ProviderPackage } from "../provider-package.js"
import { toConfig } from "./settings.js"
import { CartesiaSpeech } from "../protocols/cartesia-speech.js"

export type { CartesiaEncoding, CartesiaSpeechOptions } from "../protocols/cartesia-speech.js"

export const id = ProviderID.make("cartesia")

export type Config = TransportOptions &
  ProviderAuthOption<"optional"> & {
    readonly baseURL?: string
  }

const auth = (options: ProviderAuthOption<"optional">) => AuthOptions.bearer(options, "CARTESIA_API_KEY")

export type Settings = ProviderPackage.Settings & {
  readonly apiKey?: string | false
  readonly baseURL?: string
}

export const configure = (input: Config = {}) => {
  const media = MediaRoute.deployment(input, auth(input))
  const speech = (modelID: string | ModelID, providerOptions?: ProviderOptions) =>
    CartesiaSpeech.model({ ...media, id: modelID, providerOptions })
  return {
    id,
    speech,
    configure,
  }
}

export const provider = configure()
export const speech = provider.speech

export const speechModel = (modelID: string, settings?: Settings) => {
  const input = toConfig(settings)
  return configure(input).speech(modelID, input.providerOptions)
}

export const model = speechModel
