import { AuthOptions, type ProviderAuthOption } from "../route/auth-options"
import type { Route, RouteDefaultsInput } from "../route/client"
import type { ProviderPackage } from "../provider-package"
import { ProviderID, type ModelID } from "../schema"
import * as OpenAIChat from "../protocols/openai-chat"
import * as OpenAIResponses from "../protocols/openai-responses"
import { withOpenAIOptions, type OpenAIProviderOptionsInput } from "./openai-options"

export type { OpenAIOptionsInput, OpenAIResponseIncludable } from "./openai-options"

export const id = ProviderID.make("openai")

export const routes = [OpenAIResponses.route, OpenAIResponses.webSocketRoute, OpenAIChat.route]

// This provider facade wraps the lower-level Responses and Chat model factories
// with OpenAI-specific conveniences: typed options, API-key sugar, env fallback,
// and default option normalization.
export type Config = RouteDefaultsInput &
  ProviderAuthOption<"optional"> & {
    readonly baseURL?: string
    readonly queryParams?: Record<string, string>
    readonly providerOptions?: OpenAIProviderOptionsInput
  }

export interface Settings extends ProviderPackage.Settings {
  readonly apiKey?: string
  readonly baseURL?: string
  readonly organization?: string
  readonly project?: string
  readonly queryParams?: Readonly<Record<string, string>>
  readonly transport?: "http" | "websocket"
  readonly providerOptions?: OpenAIProviderOptionsInput
}

const auth = (options: ProviderAuthOption<"optional">) => AuthOptions.bearer(options, "OPENAI_API_KEY")

const defaults = (input: Config) => {
  const { apiKey: _, auth: _auth, baseURL: _baseURL, queryParams: _queryParams, ...rest } = input
  return rest
}

const configuredRoute = <Body, Prepared>(route: Route<Body, Prepared>, input: Config) =>
  route.with({
    auth: auth(input),
    endpoint: { baseURL: input.baseURL, query: input.queryParams },
  })

export const configure = (input: Config = {}) => {
  const responsesRoute = configuredRoute(OpenAIResponses.route, input)
  const responsesWebSocketRoute = configuredRoute(OpenAIResponses.webSocketRoute, input)
  const chatRoute = configuredRoute(OpenAIChat.route, input)
  const modelDefaults = defaults(input)
  const responses = (id: string | ModelID) =>
    responsesRoute.with(withOpenAIOptions(id, modelDefaults, { textVerbosity: true })).model({ id })
  const responsesWebSocket = (id: string | ModelID) =>
    responsesWebSocketRoute.with(withOpenAIOptions(id, modelDefaults, { textVerbosity: true })).model({ id })
  const chat = (id: string | ModelID) => chatRoute.with(withOpenAIOptions(id, modelDefaults)).model({ id })

  return {
    id,
    model: responses,
    responses,
    responsesWebSocket,
    chat,
    configure,
  }
}

export const provider = configure()

const config = (settings: Settings): Config => {
  const headers = {
    ...(settings.organization === undefined ? {} : { "OpenAI-Organization": settings.organization }),
    ...(settings.project === undefined ? {} : { "OpenAI-Project": settings.project }),
    ...settings.headers,
  }
  return {
    apiKey: settings.apiKey,
    baseURL: settings.baseURL,
    headers: Object.keys(headers).length === 0 ? undefined : headers,
    http: settings.body === undefined ? undefined : { body: { ...settings.body } },
    limits: settings.limits,
    providerOptions: settings.providerOptions,
    queryParams: settings.queryParams === undefined ? undefined : { ...settings.queryParams },
  }
}

export const model: ProviderPackage.Definition<Settings>["model"] = (modelID, settings) => {
  const configured = configure(config(settings))
  if (settings.transport === undefined || settings.transport === "http") return configured.responses(modelID)
  if (settings.transport === "websocket") return configured.responsesWebSocket(modelID)
  throw new Error(`Unsupported OpenAI Responses transport: ${String(settings.transport)}`)
}

export const chatModel: ProviderPackage.Definition<Settings>["model"] = (modelID, settings) =>
  configure(config(settings)).chat(modelID)
export const responses = provider.responses
export const responsesWebSocket = provider.responsesWebSocket
export const chat = provider.chat
