import { AuthOptions, type ProviderAuthOption } from "../route/auth-options.js"
import { HttpOptions, ProviderID, type ModelID } from "../schema/index.js"
import { DEFAULT_BASE_URL, RunwayVideo } from "../protocols/runway-video.js"

export type { RunwayVideoOptions } from "../protocols/runway-video.js"

export const id = ProviderID.make("runway")
const baseURL = DEFAULT_BASE_URL

export type Config = ProviderAuthOption<"optional"> & {
  readonly baseURL?: string
  readonly headers?: Record<string, string>
  readonly http?: HttpOptions.Input
}

const auth = (options: ProviderAuthOption<"optional">) => AuthOptions.bearer(options, "RUNWAYML_API_SECRET")

export const configure = (input: Config = {}) => {
  const video = (modelID: string | ModelID) =>
    RunwayVideo.model({
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
