import { AuthOptions, type ProviderAuthOption } from "../route/auth-options.js"
import { MediaRoute } from "../route/media.js"
import { type HttpOptions, ProviderID, type ModelID } from "../schema/index.js"
import { ReplicateImages } from "../protocols/replicate-images.js"

export type { ReplicateImageOptions } from "../protocols/replicate-images.js"

export const id = ProviderID.make("replicate")

export type Config = ProviderAuthOption<"optional"> & {
  readonly baseURL?: string
  /** `{ Prefer: "wait=60" }` holds the submission open until the prediction finishes (up to 60 seconds). */
  readonly headers?: Record<string, string>
  readonly http?: HttpOptions.Input
}

const auth = (options: ProviderAuthOption<"optional">) => AuthOptions.bearer(options, "REPLICATE_API_TOKEN")

export const configure = (input: Config = {}) => {
  const media = MediaRoute.deployment(input, auth(input))
  const image = (modelID: string | ModelID) => ReplicateImages.model({ ...media, id: modelID })
  return {
    id,
    image,
    configure,
  }
}

export const provider = configure()
export const image = provider.image
