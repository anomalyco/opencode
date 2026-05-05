import { Adapter } from "../adapter"
import type { ModelInput } from "../llm"
import { ProviderID } from "../schema"
import { OpenAIChat } from "./openai-chat"
import { OpenAIResponses } from "./openai-responses"

export const id = ProviderID.make("azure")

export type ModelOptions = Omit<ModelInput, "id" | "provider" | "protocol"> & {
  readonly resourceName?: string
  readonly apiVersion?: string
  readonly useCompletionUrls?: boolean
}

const resourceBaseURL = (resourceName: string | undefined) => {
  const resource = resourceName?.trim()
  if (!resource) return undefined
  return `https://${resource}.openai.azure.com/openai/v1`
}

export const adapters = [OpenAIResponses.adapter, OpenAIChat.adapter]

const chatModel = Adapter.model(OpenAIChat.adapter, { provider: id })
const responsesModel = Adapter.model(OpenAIResponses.adapter, { provider: id })

export const model = (modelID: string, options: ModelOptions = {}) => {
  const { apiVersion, resourceName, useCompletionUrls, ...rest } = options
  const create = useCompletionUrls === true ? chatModel : responsesModel
  return create({
    ...rest,
    id: modelID,
    baseURL: rest.baseURL ?? resourceBaseURL(resourceName),
    queryParams: {
      ...rest.queryParams,
      "api-version": apiVersion ?? rest.queryParams?.["api-version"] ?? "v1",
    },
  })
}

export * as Azure from "./azure"
