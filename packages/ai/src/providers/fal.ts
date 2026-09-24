import { Auth } from "../route/auth.js"
import type { ProviderAuthOption } from "../route/auth-options.js"
import { HttpOptions, ProviderID, type ModelID } from "../schema/index.js"
import { FalImages } from "../protocols/fal-images.js"
import { FalVideo } from "../protocols/fal-video.js"
import { FalQueue } from "../protocols/utils/fal-queue.js"

export type { FalImageOptions } from "../protocols/fal-images.js"
export type { FalVideoOptions } from "../protocols/fal-video.js"

export const id = ProviderID.make("fal")
const baseURL = FalQueue.DEFAULT_BASE_URL

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
  const media = (modelID: string | ModelID) => ({
    id: modelID,
    auth: auth(input),
    baseURL: input.baseURL ?? baseURL,
    headers: input.headers,
    http: input.http === undefined ? undefined : HttpOptions.make(input.http),
  })
  return {
    id,
    image: (modelID: string | ModelID) => FalImages.model(media(modelID)),
    video: (modelID: string | ModelID) => FalVideo.model(media(modelID)),
    configure,
  }
}

export const provider = configure()
export const image = provider.image
export const video = provider.video
