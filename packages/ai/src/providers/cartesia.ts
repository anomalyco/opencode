import { AuthOptions, type ProviderAuthOption } from "../route/auth-options.js"
import { MediaRoute } from "../route/media.js"
import { type HttpOptions, ProviderID, type ModelID } from "../schema/index.js"
import { CartesiaSpeech } from "../protocols/cartesia-speech.js"

export type { CartesiaEncoding, CartesiaSpeechOptions } from "../protocols/cartesia-speech.js"

export const id = ProviderID.make("cartesia")

export type Config = ProviderAuthOption<"optional"> & {
  readonly baseURL?: string
  readonly headers?: Record<string, string>
  readonly http?: HttpOptions.Input
}

const auth = (options: ProviderAuthOption<"optional">) => AuthOptions.bearer(options, "CARTESIA_API_KEY")

export const configure = (input: Config = {}) => {
  const media = MediaRoute.deployment(input, auth(input))
  const speech = (modelID: string | ModelID) => CartesiaSpeech.model({ ...media, id: modelID })
  return {
    id,
    speech,
    configure,
  }
}

export const provider = configure()
export const speech = provider.speech
