import { AuthOptions, type ProviderAuthOption } from "../route/auth-options.js"
import { MediaRoute } from "../route/media.js"
import { type HttpOptions, ProviderID, type ModelID } from "../schema/index.js"
import { RunwayVideo } from "../protocols/runway-video.js"

export type { RunwayVideoOptions } from "../protocols/runway-video.js"

export const id = ProviderID.make("runway")

export type Config = ProviderAuthOption<"optional"> & {
  readonly baseURL?: string
  readonly headers?: Record<string, string>
  readonly http?: HttpOptions.Input
}

const auth = (options: ProviderAuthOption<"optional">) => AuthOptions.bearer(options, "RUNWAYML_API_SECRET")

export const configure = (input: Config = {}) => {
  const media = MediaRoute.deployment(input, auth(input))
  const video = (modelID: string | ModelID) => RunwayVideo.model({ ...media, id: modelID })
  return {
    id,
    video,
    configure,
  }
}

export const provider = configure()
export const video = provider.video
