import { Adapter } from "../adapter/client"
import type { ModelInput } from "../llm"
import { Provider } from "../provider"
import { ProviderID, type ModelID } from "../schema"
import * as OpenAIChat from "../protocols/openai-chat"
import * as OpenAIResponses from "../protocols/openai-responses"
import { withOpenAIOptions, type OpenAIProviderOptionsInput } from "./openai-options"

export const id = ProviderID.make("github-copilot")

export type ModelOptions = Omit<ModelInput, "id" | "provider" | "protocol"> & {
  readonly providerOptions?: OpenAIProviderOptionsInput
}
type CopilotModelInput = ModelOptions & Pick<ModelInput, "id">

export const shouldUseResponsesApi = (modelID: string | ModelID) => {
  const model = String(modelID)
  const match = /^gpt-(\d+)/.exec(model)
  if (!match) return false
  return Number(match[1]) >= 5 && !model.startsWith("gpt-5-mini")
}

export const adapters = [OpenAIResponses.adapter, OpenAIChat.adapter]

const mapInput = (input: CopilotModelInput) => withOpenAIOptions(input.id, input)

const chatModel = Adapter.model<CopilotModelInput>(OpenAIChat.adapter, { provider: id }, { mapInput })
const responsesModel = Adapter.model<CopilotModelInput>(OpenAIResponses.adapter, { provider: id }, { mapInput })

export const responses = (modelID: string | ModelID, options: ModelOptions = {}) => responsesModel({ ...options, id: modelID })

export const chat = (modelID: string | ModelID, options: ModelOptions = {}) => chatModel({ ...options, id: modelID })

export const model = (modelID: string | ModelID, options: ModelOptions = {}) => {
  const create = shouldUseResponsesApi(modelID) ? responsesModel : chatModel
  return create({ ...options, id: modelID })
}

export const provider = Provider.make({
  id,
  model,
  apis: { responses, chat },
})

export const apis = provider.apis
