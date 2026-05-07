import { Auth } from "../route/auth"
import type { ProviderAuthOption } from "../route/auth-options"
import { Route } from "../route/client"
import type { ModelInput } from "../llm"
import { Provider } from "../provider"
import { ProviderID, type ModelID } from "../schema"
import * as OpenAIChat from "../protocols/openai-chat"
import * as OpenAIResponses from "../protocols/openai-responses"
import { withOpenAIOptions, type OpenAIProviderOptionsInput } from "./openai-options"

export const id = ProviderID.make("azure")
const MISSING_BASE_URL = "Azure OpenAI requires resourceName or baseURL"
const routeAuth = Auth.remove("authorization").andThen(Auth.apiKeyHeader("api-key"))

export type ModelOptions = Omit<ModelInput, "id" | "provider" | "route" | "apiKey" | "auth"> & ProviderAuthOption<"optional"> & {
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

const responsesAdapter = OpenAIResponses.makeRoute({
  id: "azure-openai-responses",
    auth: routeAuth,
  defaultBaseURL: false,
  endpointRequired: MISSING_BASE_URL,
})

const chatAdapter = OpenAIChat.makeRoute({
  id: "azure-openai-chat",
    auth: routeAuth,
  defaultBaseURL: false,
  endpointRequired: MISSING_BASE_URL,
})

export const routes = [responsesAdapter, chatAdapter]

const mapInput = (input: AzureModelInput) => {
  const { apiKey: _, apiVersion, resourceName, useCompletionUrls, ...rest } = input
  return {
    ...withOpenAIOptions(input.id, rest),
    auth: "auth" in input && input.auth
      ? input.auth
      : Auth.remove("authorization").andThen(
        Auth.optional("apiKey" in input ? input.apiKey : undefined, "apiKey")
          .orElse(Auth.config("AZURE_OPENAI_API_KEY"))
          .pipe(Auth.header("api-key")),
      ),
    baseURL: rest.baseURL ?? resourceBaseURL(resourceName),
    queryParams: {
      ...rest.queryParams,
      "api-version": apiVersion ?? rest.queryParams?.["api-version"] ?? "v1",
    },
  }
}

const chatModel = Route.model<AzureModelInput>(chatAdapter, { provider: id }, { mapInput })
const responsesModel = Route.model<AzureModelInput>(responsesAdapter, { provider: id }, { mapInput })

export const responses = (modelID: string | ModelID, options: ModelOptions = {}) => responsesModel({ ...options, id: modelID })

export const chat = (modelID: string | ModelID, options: ModelOptions = {}) => chatModel({ ...options, id: modelID })

export const model = (modelID: string | ModelID, options: ModelOptions = {}) => {
  if (options.useCompletionUrls === true) return chat(modelID, options)
  return responses(modelID, options)
}

export const provider = Provider.make({
  id,
  model,
  apis: { responses, chat },
})

export const apis = provider.apis
