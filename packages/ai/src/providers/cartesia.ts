import { AuthOptions, type ProviderAuthOption } from "../route/auth-options.js"
import { HttpOptions, ProviderID, type ModelID } from "../schema/index.js"
import { CartesiaSpeech, DEFAULT_BASE_URL } from "../protocols/cartesia-speech.js"

export type { CartesiaEncoding, CartesiaSpeechOptions } from "../protocols/cartesia-speech.js"

export const id = ProviderID.make("cartesia")
const baseURL = DEFAULT_BASE_URL

export type Config = ProviderAuthOption<"optional"> & {
  readonly baseURL?: string
  readonly headers?: Record<string, string>
  readonly http?: HttpOptions.Input
}

const auth = (options: ProviderAuthOption<"optional">) => AuthOptions.bearer(options, "CARTESIA_API_KEY")

export const configure = (input: Config = {}) => {
  const speech = (modelID: string | ModelID) =>
    CartesiaSpeech.model({
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
