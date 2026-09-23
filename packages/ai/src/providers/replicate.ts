import { AuthOptions, type ProviderAuthOption } from "../route/auth-options.js"
import { HttpOptions, ProviderID, type ModelID } from "../schema/index.js"
import { DEFAULT_BASE_URL, ReplicateImages } from "../protocols/replicate-images.js"

export type { ReplicateImageOptions } from "../protocols/replicate-images.js"

export const id = ProviderID.make("replicate")
const baseURL = DEFAULT_BASE_URL

export type Config = ProviderAuthOption<"optional"> & {
  readonly baseURL?: string
  /** `{ Prefer: "wait=60" }` holds the submission open until the prediction finishes (up to 60 seconds). */
  readonly headers?: Record<string, string>
  readonly http?: HttpOptions.Input
}

const auth = (options: ProviderAuthOption<"optional">) => AuthOptions.bearer(options, "REPLICATE_API_TOKEN")

export const configure = (input: Config = {}) => {
  const image = (modelID: string | ModelID) =>
    ReplicateImages.model({
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
