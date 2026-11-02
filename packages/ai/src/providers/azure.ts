import { Auth } from "../route/auth.js"
import { AuthOptions, type AtLeastOne, type ProviderAuthOption } from "../route/auth-options.js"
import type { Route, RouteDefaultsInput, CompactionOperations } from "../route/client.js"
import { Endpoint } from "../route/endpoint.js"
import type { ProviderPackage } from "../provider-package.js"
import { MediaRoute } from "../route/media.js"
import {
  HttpOptions,
  ProviderConfigurationError,
  ProviderID,
  mergeHttpOptions,
  type ModelID,
  type ProviderOptions,
} from "../schema/index.js"
import { AnthropicMessages } from "../protocols/anthropic-messages.js"
import { OpenAIImages } from "../protocols/openai-images.js"
import * as OpenAIChat from "../protocols/openai-chat.js"
import * as OpenAIResponses from "../protocols/openai-responses.js"
import { withOpenAIOptions, type OpenAIProviderOptionsInput } from "./openai-options.js"

export const id = ProviderID.make("azure")
const routeAuth = Auth.remove("authorization")
const RESPONSES_WEBSOCKET_ROTATE_AFTER_MS = 55 * 60 * 1000

// Azure needs the customer's resource URL; supply either `resourceName`
// (helper builds the URL) or `baseURL` directly.
type AzureURL = AtLeastOne<{ readonly resourceName: string; readonly baseURL: string }>

export type Config = AzureURL &
  RouteDefaultsInput &
  ProviderAuthOption<"optional"> & {
    readonly apiVersion?: string
    readonly queryParams?: Record<string, string>
    readonly useDeploymentBasedUrls?: boolean
    readonly providerOptions?: OpenAIProviderOptionsInput | AnthropicMessages.ProviderOptionsInput
  }

export type Settings<Options = OpenAIProviderOptionsInput> = ProviderPackage.Settings &
  Options &
  AzureURL & {
    readonly apiKey?: string | false
    readonly apiVersion?: string
    readonly queryParams?: Readonly<Record<string, string>>
    readonly useDeploymentBasedUrls?: boolean
  }

export type MessagesSettings = Settings<AnthropicMessages.ProviderOptionsInput>

const resourceBaseURL = (resourceName: string) => `https://${resourceName.trim()}.openai.azure.com/openai`

const responsesRoute = OpenAIResponses.route.with({
  compact: { endpoint: OpenAIResponses.route.compact.endpoint },
  id: "azure-openai-responses",
  provider: id,
  auth: routeAuth,
  transport: OpenAIResponses.channelTransport({
    id: "azure-openai-responses",
    name: "Azure OpenAI Responses",
    rotateAfterMs: RESPONSES_WEBSOCKET_ROTATE_AFTER_MS,
    enabled: (value) => {
      const url = new URL(value)
      return (
        url.protocol === "https:" &&
        url.hostname.endsWith(".openai.azure.com") &&
        url.pathname.endsWith("/openai/v1/responses") &&
        url.searchParams.get("api-version") === "v1"
      )
    },
    url: (value) => {
      const url = new URL(value)
      url.searchParams.delete("api-version")
      return url.toString()
    },
  }),
})

const chatRoute = OpenAIChat.route.with({
  id: "azure-openai-chat",
  provider: id,
  auth: routeAuth,
})

// Claude on Foundry serves Anthropic Messages under the resource's `services.ai.azure.com` host and accepts the
// resource key as `x-api-key`; it rejects `api-key`.
const messagesRoute = AnthropicMessages.route.with({ id: "azure-anthropic-messages", provider: id })

export const routes = [responsesRoute, chatRoute, messagesRoute]

const defaults = (input: Config) => {
  const {
    apiKey: _,
    apiVersion: _apiVersion,
    resourceName: _resourceName,
    useDeploymentBasedUrls: _useDeploymentBasedUrls,
    baseURL: _baseURL,
    queryParams: _queryParams,
    ...rest
  } = input
  if ("auth" in rest) {
    const { auth: _, ...withoutAuth } = rest
    return withoutAuth
  }
  return rest
}

const auth = (input: Config, header = "api-key") => {
  if ("auth" in input && input.auth) return input.auth
  return Auth.remove("authorization").andThen(AuthOptions.apiKey(input, "AZURE_OPENAI_API_KEY", Auth.header(header)))
}

const configuredRoute = <Body, Prepared, Compact extends CompactionOperations | undefined>(
  route: Route<Body, Prepared, Compact>,
  input: Config,
  modelID: string | ModelID,
) =>
  route.with({
    auth: auth(input),
    endpoint: endpoint(input, modelID),
  })

function endpoint(input: Config, modelID: string | ModelID) {
  const baseURL = Endpoint.trimBaseUrl(input.baseURL ?? resourceBaseURL(input.resourceName!))
  const query = { "api-version": input.apiVersion ?? "v1", ...input.queryParams }

  if (input.useDeploymentBasedUrls) return { baseURL: `${baseURL}/deployments/${modelID}`, query }
  if (input.baseURL !== undefined && !new URL(input.baseURL).hostname.endsWith(".openai.azure.com")) {
    return { baseURL, query: input.queryParams }
  }
  return { baseURL: `${baseURL}/v1`, query }
}

export const configure = (input: Config) => {
  const modelDefaults = defaults(input)

  const responses = (modelID: string | ModelID) =>
    configuredRoute(responsesRoute, input, modelID)
      .with(withOpenAIOptions(modelID, modelDefaults))
      .model<OpenAIProviderOptionsInput>({ id: modelID })

  const chat = (modelID: string | ModelID) =>
    configuredRoute(chatRoute, input, modelID)
      .with(withOpenAIOptions(modelID, modelDefaults))
      .model<OpenAIProviderOptionsInput>({ id: modelID, compatibility: { supportsPromptCacheKey: true } })

  const messages = (modelID: string | ModelID) =>
    messagesRoute
      .with({
        ...modelDefaults,
        auth: auth(input, "x-api-key"),
        endpoint: {
          baseURL: Endpoint.trimBaseUrl(
            input.baseURL ?? `https://${input.resourceName!.trim()}.services.ai.azure.com/anthropic/v1`,
          ),
          query: input.queryParams,
        },
      })
      .model<AnthropicMessages.ProviderOptionsInput>({ id: modelID })

  const image = (modelID: string | ModelID, providerOptions?: ProviderOptions) => {
    const target = endpoint(input, modelID)
    const media = MediaRoute.deployment({ ...input, baseURL: target.baseURL }, auth(input))
    return OpenAIImages.model({
      ...media,
      id: modelID,
      provider: id,
      providerOptions,
      http: mergeHttpOptions(
        media.http,
        target.query === undefined ? undefined : new HttpOptions({ query: target.query }),
      ),
    })
  }

  return {
    id,
    model: responses,
    responses,
    chat,
    messages,
    image,
    configure,
  }
}

export const provider = {
  id,
  configure,
}

const config = ({
  apiKey,
  apiVersion,
  baseURL,
  body,
  headers,
  queryParams,
  resourceName,
  useDeploymentBasedUrls,
  ...providerOptions
}: Settings<Config["providerOptions"]>): Config => {
  const common = {
    apiKey,
    apiVersion,
    headers,
    http: body === undefined ? undefined : { body },
    providerOptions,
    queryParams,
    useDeploymentBasedUrls,
  }
  if (baseURL !== undefined) return { ...common, baseURL }
  if (resourceName !== undefined) return { ...common, resourceName }
  throw new ProviderConfigurationError({ provider: id, message: "Azure requires resourceName or baseURL" })
}

export const responsesModel: ProviderPackage.Model<
  Settings,
  OpenAIProviderOptionsInput,
  typeof responsesRoute.compact
> = (modelID, settings) => configure(config(settings)).responses(modelID)
export const chatModel: ProviderPackage.Model<Settings, OpenAIProviderOptionsInput> = (modelID, settings) =>
  configure(config(settings)).chat(modelID)
export const messagesModel: ProviderPackage.Model<MessagesSettings, AnthropicMessages.ProviderOptionsInput> = (
  modelID,
  settings,
) => configure(config(settings)).messages(modelID)
export const imageModel = (modelID: string, settings: Settings) => {
  const input = config(settings)
  return configure(input).image(modelID, input.providerOptions)
}
export const model = responsesModel
export const responses = responsesModel
export const chat = chatModel
