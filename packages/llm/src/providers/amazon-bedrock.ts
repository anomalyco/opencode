import { Adapter, type AdapterModelInput } from "../adapter"
import * as BedrockConverse from "../protocols/bedrock-converse"
import type { BedrockCredentials } from "../protocols/bedrock-converse"

export type ModelOptions = Omit<AdapterModelInput, "id"> & {
  readonly apiKey?: string
  readonly headers?: Record<string, string>
  readonly credentials?: BedrockCredentials
}

export const adapters = [BedrockConverse.adapter]

const converseModel = Adapter.model(BedrockConverse.adapter, {
  provider: "amazon-bedrock",
  capabilities: BedrockConverse.defaultCapabilities,
})

export const model = (modelID: string, options: ModelOptions = {}) => {
  const { credentials, ...rest } = options
  return converseModel({
    ...rest,
    id: modelID,
    native: BedrockConverse.nativeCredentials(options.native, credentials),
  })
}
