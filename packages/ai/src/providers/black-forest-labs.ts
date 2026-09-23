import { Auth } from "../route/auth.js"
import type { ProviderAuthOption } from "../route/auth-options.js"
import { HttpOptions, ProviderID, type ModelID } from "../schema/index.js"
import { BlackForestLabsImages, DEFAULT_BASE_URL } from "../protocols/bfl-images.js"

export type { BlackForestLabsImageOptions } from "../protocols/bfl-images.js"

export const id = ProviderID.make("black-forest-labs")
const baseURL = DEFAULT_BASE_URL

export type Config = ProviderAuthOption<"optional"> & {
  /** `https://api.eu.bfl.ai` or `https://api.us.bfl.ai` pin inference to one region. */
  readonly baseURL?: string
  readonly headers?: Record<string, string>
  readonly http?: HttpOptions.Input
}

const auth = (options: ProviderAuthOption<"optional">) => {
  if ("auth" in options && options.auth) return options.auth
  return Auth.optional("apiKey" in options ? options.apiKey : undefined, "apiKey")
    .orElse(Auth.config("BFL_API_KEY"))
    .pipe(Auth.header("x-key"))
}

export const configure = (input: Config = {}) => {
  const image = (modelID: string | ModelID) =>
    BlackForestLabsImages.model({
      id: modelID,
      auth: auth(input),
      baseURL: input.baseURL ?? baseURL,
      headers: input.headers,
      http: input.http === undefined ? undefined : HttpOptions.make(input.http),
    })
  return {
    id,
    image,
    configure,
  }
}

export const provider = configure()
export const image = provider.image
