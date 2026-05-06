import { Adapter } from "../adapter/client"
import type { ModelInput } from "../llm"
import { ProviderID } from "../schema"
import * as OpenAIChat from "../protocols/openai-chat"
import * as OpenAIResponses from "../protocols/openai-responses"
import { withOpenAIOptions, type OpenAIProviderOptionsInput } from "./openai-options"

export const id = ProviderID.make("azure")

export type ModelOptions = Omit<ModelInput, "id" | "provider" | "protocol"> & {
  readonly resourceName?: string
  readonly apiVersion?: string
  readonly useCompletionUrls?: boolean
  readonly providerOptions?: OpenAIProviderOptionsInput
}
type AzureModelInput = ModelOptions & Pick<ModelInput, "id">

const resourceBaseURL = (resourceName: string | undefined) => {
  const resource = resourceName?.trim()
  if (!resource) return undefined
  return `https://${resource}.openai.azure.com/openai/v1`
}

export const adapters = [OpenAIResponses.adapter, OpenAIChat.adapter]

const mapInput = (input: AzureModelInput) => {
  const { apiVersion, resourceName, useCompletionUrls, ...rest } = input
  return {
    ...withOpenAIOptions(input.id, rest),
    baseURL: rest.baseURL ?? resourceBaseURL(resourceName),
    queryParams: {
      ...rest.queryParams,
      "api-version": apiVersion ?? rest.queryParams?.["api-version"] ?? "v1",
    },
  }
}

const chatModel = Adapter.model<AzureModelInput>(OpenAIChat.adapter, { provider: id }, { mapInput })
const responsesModel = Adapter.model<AzureModelInput>(OpenAIResponses.adapter, { provider: id }, { mapInput })

export const model = (modelID: string, options: ModelOptions = {}) => {
  const create = options.useCompletionUrls === true ? chatModel : responsesModel
  return create({ ...options, id: modelID })
}
