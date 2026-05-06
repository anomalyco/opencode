import { Headers } from "effect/unstable/http"
import { Auth } from "../adapter/auth"
import type { Auth as AuthFn } from "../adapter/auth"
import { Adapter } from "../adapter/client"
import type { ModelInput } from "../llm"
import { ProviderID } from "../schema"
import * as OpenAIChat from "../protocols/openai-chat"
import * as OpenAIResponses from "../protocols/openai-responses"
import { withOpenAIOptions, type OpenAIProviderOptionsInput } from "./openai-options"

export const id = ProviderID.make("azure")
const MISSING_BASE_URL = "Azure OpenAI requires resourceName or baseURL"
const apiKeyAuth = Auth.apiKeyHeader("api-key")
const auth: AuthFn = (input) => apiKeyAuth({ ...input, headers: Headers.remove(input.headers, "authorization") })

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

const responsesAdapter = OpenAIResponses.makeAdapter({
  id: "azure-openai-responses",
  auth,
  defaultBaseURL: false,
  endpointRequired: MISSING_BASE_URL,
})

const chatAdapter = OpenAIChat.makeAdapter({
  id: "azure-openai-chat",
  auth,
  defaultBaseURL: false,
  endpointRequired: MISSING_BASE_URL,
})

export const adapters = [responsesAdapter, chatAdapter]

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

const chatModel = Adapter.model<AzureModelInput>(chatAdapter, { provider: id }, { mapInput })
const responsesModel = Adapter.model<AzureModelInput>(responsesAdapter, { provider: id }, { mapInput })

export const responses = (modelID: string, options: ModelOptions = {}) => responsesModel({ ...options, id: modelID })

export const chat = (modelID: string, options: ModelOptions = {}) => chatModel({ ...options, id: modelID })

export const model = (modelID: string, options: ModelOptions = {}) => {
  if (options.useCompletionUrls === true) return chat(modelID, options)
  return responses(modelID, options)
}
