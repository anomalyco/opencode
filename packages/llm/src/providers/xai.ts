import { Adapter } from "../adapter/client"
import type { ModelInput } from "../llm"
import { Provider } from "../provider"
import { ProviderID, type ModelID } from "../schema"
import * as OpenAICompatibleProfiles from "./openai-compatible-profile"
import * as OpenAIResponses from "../protocols/openai-responses"

export const id = ProviderID.make("xai")

export type ModelOptions = Omit<ModelInput, "id" | "provider" | "protocol">

export const adapters = [OpenAIResponses.adapter]

const responsesModel = Adapter.model(OpenAIResponses.adapter, { provider: "xai" })

export const model = (modelID: string | ModelID, options: ModelOptions = {}) =>
  responsesModel({
    ...options,
    id: modelID,
    baseURL: options.baseURL ?? OpenAICompatibleProfiles.profiles.xai.baseURL,
  })

export const provider = Provider.make({
  id,
  model,
})
