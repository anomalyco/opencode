import { Auth } from "../route/auth.js"
import type { ProviderAuthOption } from "../route/auth-options.js"
import { HttpOptions, ProviderID, type ModelID } from "../schema/index.js"
import { DEFAULT_BASE_URL, FalVideo } from "../protocols/fal-video.js"

export type { FalVideoOptions } from "../protocols/fal-video.js"

export const id = ProviderID.make("fal")
const baseURL = DEFAULT_BASE_URL

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
  const video = (modelID: string | ModelID) =>
    FalVideo.model({
      id: modelID,
      auth: auth(input),
      baseURL: input.baseURL ?? baseURL,
      headers: input.headers,
      http: input.http === undefined ? undefined : HttpOptions.make(input.http),
    })
  return {
    id,
    video,
    configure,
  }
}

export const provider = configure()
export const video = provider.video
