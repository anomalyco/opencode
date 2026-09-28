import { Auth } from "../route/auth.js"
import type { ProviderAuthOption } from "../route/auth-options.js"
import { MediaRoute } from "../route/media.js"
import { type HttpOptions, ProviderID, type ModelID } from "../schema/index.js"
import { BlackForestLabsImages } from "../protocols/bfl-images.js"

export type { BlackForestLabsImageOptions } from "../protocols/bfl-images.js"

export const id = ProviderID.make("black-forest-labs")

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
  const media = MediaRoute.deployment(input, auth(input))
  const image = (modelID: string | ModelID) => BlackForestLabsImages.model({ ...media, id: modelID })
  return {
    id,
    image,
    configure,
  }
}

export const provider = configure()
export const image = provider.image
