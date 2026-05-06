import { Adapter } from "../adapter"
import type { ModelInput } from "../llm"
import { ProviderID } from "../schema"
import * as OpenAIChat from "../protocols/openai-chat"
import * as OpenAIResponses from "../protocols/openai-responses"
import { withOpenAIPolicy, type OpenAIOptionsInput } from "./openai-policy"

export const id = ProviderID.make("github-copilot")

export type ModelOptions = Omit<ModelInput, "id" | "provider" | "protocol"> & {
  readonly openai?: OpenAIOptionsInput
}
type CopilotModelInput = ModelOptions & Pick<ModelInput, "id">

export const shouldUseResponsesApi = (modelID: string) => {
  const match = /^gpt-(\d+)/.exec(modelID)
  if (!match) return false
  return Number(match[1]) >= 5 && !modelID.startsWith("gpt-5-mini")
}

export const adapters = [OpenAIResponses.adapter, OpenAIChat.adapter]

const mapInput = (input: CopilotModelInput) => withOpenAIPolicy(input.id, input)

const chatModel = Adapter.model<CopilotModelInput>(OpenAIChat.adapter, { provider: id }, { mapInput })
const responsesModel = Adapter.model<CopilotModelInput>(OpenAIResponses.adapter, { provider: id }, { mapInput })

export const model = (modelID: string, options: ModelOptions = {}) => {
  const create = shouldUseResponsesApi(modelID) ? responsesModel : chatModel
  return create({ ...options, id: modelID })
}
