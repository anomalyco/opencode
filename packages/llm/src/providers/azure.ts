import { Auth } from "../route/auth"
import { type AtLeastOne, type ProviderAuthOption } from "../route/auth-options"
import type { Route as RouteDef } from "../route/client"
import type { ModelInput } from "../llm"
import { Provider } from "../provider"
import { ProviderID, type ModelID } from "../schema"
import * as OpenAIChat from "../protocols/openai-chat"
import * as OpenAIResponses from "../protocols/openai-responses"
import { withOpenAIOptions, type OpenAIProviderOptionsInput } from "./openai-options"

export const id = ProviderID.make("azure")
const routeAuth = Auth.remove("authorization").andThen(Auth.apiKeyHeader("api-key"))

// Azure needs the customer's resource URL; supply either `resourceName`
// (helper builds the URL) or `baseURL` directly.
type AzureURL = AtLeastOne<{ readonly resourceName: string; readonly baseURL: string }>

export type ModelOptions = AzureURL &
  Omit<ModelInput, "id" | "provider" | "route" | "apiKey" | "auth" | "baseURL"> &
  ProviderAuthOption<"optional"> & {
    readonly apiVersion?: string
    readonly useCompletionUrls?: boolean
    readonly providerOptions?: OpenAIProviderOptionsInput
  }
type AzureModelInput = ModelOptions & Pick<ModelInput, "id">

const resourceBaseURL = (resourceName: string) => `https://${resourceName.trim()}.openai.azure.com/openai/v1`

const responsesRoute = OpenAIResponses.route.with({
  id: "azure-openai-responses",
  provider: id,
  endpoint: {
    query: { "api-version": "v1" },
  },
  transport: OpenAIResponses.httpTransport.with({ auth: routeAuth }),
})

const chatRoute = OpenAIChat.route.with({
  id: "azure-openai-chat",
  provider: id,
  endpoint: {
    query: { "api-version": "v1" },
  },
  transport: OpenAIChat.httpTransport.with({ auth: routeAuth }),
})

export const routes = [responsesRoute, chatRoute]

const mapInput = (input: AzureModelInput) => {
  const {
    apiKey: _,
    apiVersion: _apiVersion,
    resourceName: _resourceName,
    useCompletionUrls: _useCompletionUrls,
    baseURL: _baseURL,
    queryParams: _queryParams,
    ...rest
  } = input
  return {
    ...withOpenAIOptions(input.id, rest),
    auth:
      "auth" in input && input.auth
        ? input.auth
        : Auth.remove("authorization").andThen(
            Auth.optional("apiKey" in input ? input.apiKey : undefined, "apiKey")
              .orElse(Auth.config("AZURE_OPENAI_API_KEY"))
              .pipe(Auth.header("api-key")),
          ),
  }
}

const configuredRoute = <Body, Prepared>(route: RouteDef<Body, Prepared>, input: ModelOptions) =>
  route.with({
    endpoint: {
      // AtLeastOne guarantees at least one is set; baseURL wins if both are.
      baseURL: input.baseURL ?? resourceBaseURL(input.resourceName!),
      query: {
        ...(input.apiVersion ? { "api-version": input.apiVersion } : {}),
        ...input.queryParams,
      },
    },
  })

export const responses = (modelID: string | ModelID, options: ModelOptions) =>
  configuredRoute(responsesRoute, options).model(mapInput({ ...options, id: modelID }))

export const chat = (modelID: string | ModelID, options: ModelOptions) =>
  configuredRoute(chatRoute, options).model(mapInput({ ...options, id: modelID }))

export const model = (modelID: string | ModelID, options: ModelOptions) => {
  if (options.useCompletionUrls === true) return chat(modelID, options)
  return responses(modelID, options)
}

export const provider = Provider.make({
  id,
  model,
  apis: { responses, chat },
})

export const apis = provider.apis
