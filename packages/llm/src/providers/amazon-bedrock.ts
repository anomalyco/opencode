import { Route, type RouteModelInput } from "../route/client"
import { Provider } from "../provider"
import { ProviderID, type ModelID } from "../schema"
import * as BedrockConverse from "../protocols/bedrock-converse"
import type { BedrockCredentials } from "../protocols/bedrock-converse"

export const id = ProviderID.make("amazon-bedrock")

export type ModelOptions = Omit<RouteModelInput, "id"> & {
  readonly apiKey?: string
  readonly headers?: Record<string, string>
  readonly credentials?: BedrockCredentials
}
type ModelInput = ModelOptions & Pick<RouteModelInput, "id">

export const routes = [BedrockConverse.route]

const converseModel = Route.model<ModelInput>(
  BedrockConverse.route,
  {
    provider: "amazon-bedrock",
    capabilities: BedrockConverse.defaultCapabilities,
  },
  {
    mapInput: (input) => {
      const { credentials, ...rest } = input
      return {
        ...rest,
        native: BedrockConverse.nativeCredentials(input.native, credentials),
      }
    },
  },
)

export const model = (modelID: string | ModelID, options: ModelOptions = {}) => converseModel({ ...options, id: modelID })

export const provider = Provider.make({
  id,
  model,
})
