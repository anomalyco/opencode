import { Adapter } from "../adapter"
import type { ModelInput } from "../llm"
import { ProviderID } from "../schema"
import { OpenAIChat } from "../protocols/openai-chat"
import { OpenAIResponses } from "../protocols/openai-responses"

export const id = ProviderID.make("github-copilot")

export type ModelOptions = Omit<ModelInput, "id" | "provider" | "protocol">

export const shouldUseResponsesApi = (modelID: string) => {
  const match = /^gpt-(\d+)/.exec(modelID)
  if (!match) return false
  return Number(match[1]) >= 5 && !modelID.startsWith("gpt-5-mini")
}

export const adapters = [OpenAIResponses.adapter, OpenAIChat.adapter]

const chatModel = Adapter.model(OpenAIChat.adapter, { provider: id })
const responsesModel = Adapter.model(OpenAIResponses.adapter, { provider: id })

export const model = (modelID: string, options: ModelOptions = {}) => {
  const create = shouldUseResponsesApi(modelID) ? responsesModel : chatModel
  return create({ ...options, id: modelID })
}

export * as GitHubCopilot from "./github-copilot"
