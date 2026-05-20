import type { RouteModelInput } from "../route/client"
import { Provider } from "../provider"
import { ProviderID, type ModelID } from "../schema"
import * as BedrockConverse from "../protocols/bedrock-converse"
import type { BedrockCredentials } from "../protocols/bedrock-converse"

export const id = ProviderID.make("amazon-bedrock")

export type ModelOptions = Omit<RouteModelInput, "id" | "baseURL"> & {
  readonly apiKey?: string
  readonly headers?: Record<string, string>
  readonly credentials?: BedrockCredentials
  /** AWS region. Defaults to `us-east-1` when neither this nor `credentials.region` is set. */
  readonly region?: string
  /** Override the computed `https://bedrock-runtime.<region>.amazonaws.com` URL. */
  readonly baseURL?: string
}
type ModelInput = ModelOptions & Pick<RouteModelInput, "id">

export const routes = [BedrockConverse.route]

const bedrockBaseURL = (region: string) => `https://bedrock-runtime.${region}.amazonaws.com`

export const model = (modelID: string | ModelID, options: ModelOptions = {}) => {
  const { credentials, region, baseURL, ...rest } = options
  const resolvedRegion = region ?? credentials?.region ?? "us-east-1"
  return BedrockConverse.route
    .with({ provider: id, endpoint: { baseURL: baseURL ?? bedrockBaseURL(resolvedRegion) } })
    .model({ ...rest, id: modelID, native: BedrockConverse.nativeCredentials(options.native, credentials) })
}

export const provider = Provider.make({
  id,
  model,
})
