import { Auth } from "../route/auth.js"
import type { ProviderAuthOption } from "../route/auth-options.js"
import { MediaRoute } from "../route/media.js"
import { type HttpOptions, ProviderID, type ModelID } from "../schema/index.js"
import { FalImages } from "../protocols/fal-images.js"
import { FalVideo } from "../protocols/fal-video.js"

export type { FalImageOptions } from "../protocols/fal-images.js"
export type { FalVideoOptions } from "../protocols/fal-video.js"

export const id = ProviderID.make("fal")

export type Config = ProviderAuthOption<"optional"> & {
  readonly baseURL?: string
  readonly headers?: Record<string, string>
  readonly http?: HttpOptions.Input
}

// fal authenticates with `Authorization: Key <FAL_KEY>` rather than a bearer token.
const auth = (options: ProviderAuthOption<"optional">) => {
  if ("auth" in options && options.auth) return options.auth
  return Auth.optional("apiKey" in options ? options.apiKey : undefined, "apiKey")
    .orElse(Auth.config("FAL_KEY"))
    .pipe(Auth.scheme("Key"))
}

export const configure = (input: Config = {}) => {
  const media = MediaRoute.deployment(input, auth(input))
  return {
    id,
    image: (modelID: string | ModelID) => FalImages.model({ ...media, id: modelID }),
    video: (modelID: string | ModelID) => FalVideo.model({ ...media, id: modelID }),
    configure,
  }
}

export const provider = configure()
export const image = provider.image
export const video = provider.video
