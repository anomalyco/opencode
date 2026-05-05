import { Adapter } from "../adapter"
import type { ModelInput } from "../llm"
import { OpenAICompatibleProfiles } from "./openai-compatible-profile"
import { OpenAIResponses } from "../protocols/openai-responses"

export type ModelOptions = Omit<ModelInput, "id" | "provider" | "protocol">

export const adapters = [OpenAIResponses.adapter]

const responsesModel = Adapter.model(OpenAIResponses.adapter, { provider: "xai" })

export const model = (modelID: string, options: ModelOptions = {}) =>
  responsesModel({
    ...options,
    id: modelID,
    baseURL: options.baseURL ?? OpenAICompatibleProfiles.profiles.xai.baseURL,
  })

export * as XAI from "./xai"
