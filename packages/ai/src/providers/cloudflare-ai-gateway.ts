import type { Config, Redacted } from "effect"
import type { ProviderPackage } from "../provider-package.js"
import { CloudflareRunDecisions } from "../protocols/cloudflare-run-decisions.js"
import { AnthropicMessages, OpenAIChat, OpenAIResponses } from "../protocols/index.js"
import { Auth } from "../route/auth.js"
import { Endpoint } from "../route/endpoint.js"
import { AuthOptions, type AtLeastOne, type ProviderAuthOption } from "../route/auth-options.js"
import type { RouteDefaultsInput } from "../route/client.js"
import { ProviderConfigurationError, ProviderID, type ModelID, type ProviderOptions } from "../schema/index.js"
import { encodeJson } from "../utils/json.js"
import type { OpenAIProviderOptionsInput } from "./openai-options.js"

export const id = ProviderID.make("cloudflare-ai-gateway")
export const authEnvVars = ["CLOUDFLARE_API_TOKEN", "CF_AIG_TOKEN"] as const

type GatewayURL = AtLeastOne<{
  readonly accountId: string
  readonly baseURL: string
}>

type GatewayOptions = {
  readonly gatewayId?: string
  readonly metadata?: unknown
  readonly cacheTtl?: number
  readonly cacheKey?: string
  readonly skipCache?: boolean
  readonly collectLog?: boolean
}

export type Config = GatewayURL &
  GatewayOptions &
  Omit<RouteDefaultsInput, "providerOptions"> &
  ProviderAuthOption<"optional"> & {
    readonly gatewayApiKey?: string | Redacted.Redacted | Config.Config<string | Redacted.Redacted>
    readonly providerOptions?: OpenAIProviderOptionsInput
  }

export type Settings = ProviderPackage.Settings &
  OpenAIProviderOptionsInput &
  GatewayURL &
  GatewayOptions & {
    readonly apiKey?: string | false
    readonly gatewayApiKey?: string
  }

export const baseURL = (input: GatewayURL) => {
  if (input.baseURL) return input.baseURL
  return `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(requireAccountId(input))}/ai/v1`
}

/** The Run API (`/ai/run`) next to the OpenAI-compatible `/ai/v1` base. */
export const runBaseURL = (input: GatewayURL) => {
  const url = Endpoint.trimBaseUrl(baseURL(input))
  if (!url.endsWith("/ai/v1"))
    throw new ProviderConfigurationError({
      provider: id,
      message: "CloudflareAIGateway needs accountId or a baseURL ending in /ai/v1 to derive the Run API base",
    })
  return `${url.slice(0, -"/v1".length)}/run`
}

// Cloudflare's REST API rejects parts of the Anthropic Messages and OpenAI Responses request shapes, such as
// system prompt blocks and `minimal` reasoning effort, so these models use the provider-native gateway endpoints.
const passthroughURL = (input: GatewayURL & GatewayOptions, provider: "anthropic/v1" | "openai") =>
  `https://gateway.ai.cloudflare.com/v1/${encodeURIComponent(requireAccountId(input))}/${encodeURIComponent(gatewayId(input))}/${provider}`

const requireAccountId = (input: GatewayURL) => {
  if (input.accountId) return input.accountId
  throw new ProviderConfigurationError({
    provider: id,
    message: "CloudflareAIGateway.configure requires accountId unless baseURL is supplied",
  })
}

const gatewayId = (input: GatewayOptions) => input.gatewayId?.trim() || "default"

export const responsesRoute = OpenAIResponses.route.with({
  id: "cloudflare-ai-gateway-responses",
  provider: id,
  endpoint: { baseURL: undefined },
})

export const messagesRoute = AnthropicMessages.route.with({
  id: "cloudflare-ai-gateway-messages",
  provider: id,
  endpoint: { baseURL: undefined },
})

export const route = OpenAIChat.route.with({
  id: "cloudflare-ai-gateway-chat",
  provider: id,
  endpoint: { baseURL: undefined },
})

export const routes = [responsesRoute, messagesRoute, route]

const credential = (input: Config, apply: (credential: Auth.Credential) => Auth.Definition) =>
  AuthOptions.apiKey(
    { apiKey: input.gatewayApiKey ?? ("apiKey" in input ? input.apiKey : undefined) },
    authEnvVars,
    apply,
  )

const headers = (input: Config) => ({
  ...(input.metadata === undefined ? {} : { "cf-aig-metadata": encodeJson(input.metadata) }),
  ...(input.cacheTtl === undefined ? {} : { "cf-aig-cache-ttl": String(input.cacheTtl) }),
  ...(input.cacheKey === undefined ? {} : { "cf-aig-cache-key": input.cacheKey }),
  ...(input.skipCache === undefined ? {} : { "cf-aig-skip-cache": String(input.skipCache) }),
  ...(input.collectLog === undefined ? {} : { "cf-aig-collect-log": String(input.collectLog) }),
  ...input.headers,
})

export const configure = (input: Config) => {
  const custom = "auth" in input && input.auth ? input.auth : undefined
  const rest = {
    endpoint: { baseURL: baseURL(input) },
    auth: custom ?? credential(input, (credential) => credential.bearer()),
    headers: { "cf-aig-gateway-id": gatewayId(input), ...headers(input) },
    http: input.http,
    providerOptions: input.providerOptions,
  }
  // A custom baseURL stands in for the REST API, so every model keeps using it with gateway model IDs.
  const native = input.baseURL === undefined
  const passthrough = (provider: "anthropic/v1" | "openai") =>
    native
      ? {
          ...rest,
          endpoint: { baseURL: passthroughURL(input, provider) },
          auth: custom ?? credential(input, Auth.bearerHeader("cf-aig-authorization")),
          headers: headers(input),
        }
      : rest
  const responsesConfigured = responsesRoute.with(passthrough("openai"))
  const messagesConfigured = messagesRoute.with(passthrough("anthropic/v1"))
  const chatConfigured = route.with(rest)
  const responses = (value: string | ModelID) =>
    responsesConfigured.model<OpenAIProviderOptionsInput>({
      id: native ? value.replace(/^openai\//, "") : value,
    })
  const messages = (value: string | ModelID) =>
    messagesConfigured.model<OpenAIProviderOptionsInput>({
      id: native ? value.replace(/^anthropic\//, "").replaceAll(".", "-") : value,
    })
  const chat = (value: string | ModelID) =>
    chatConfigured.model<OpenAIProviderOptionsInput>({ id: value.replace(/^workers-ai\//, "") })
  // The Run API base is derived per call so a chat-only configuration without an account still constructs.
  const decision = (value: string | ModelID, providerOptions?: ProviderOptions) =>
    CloudflareRunDecisions.route
      .with({
        provider: id,
        endpoint: { baseURL: runBaseURL(input) },
        auth: rest.auth,
        headers: rest.headers,
        http: input.http,
      })
      .model({ id: value, providerOptions })
  return {
    id,
    model: (value: string | ModelID) => {
      if (value.startsWith("openai/")) return responses(value)
      if (value.startsWith("anthropic/")) return messages(value)
      return chat(value)
    },
    chat,
    responses,
    messages,
    decision,
    configure,
  }
}

export const provider = { id, configure }

export const model: ProviderPackage.Model<Settings, OpenAIProviderOptionsInput> = (modelID, settings) =>
  configure(config(settings)).model(modelID)
export const chat: ProviderPackage.Model<Settings, OpenAIProviderOptionsInput> = (modelID, settings) =>
  configure(config(settings)).chat(modelID)
export const responses: ProviderPackage.Model<Settings, OpenAIProviderOptionsInput> = (modelID, settings) =>
  configure(config(settings)).responses(modelID)
export const messages: ProviderPackage.Model<Settings, OpenAIProviderOptionsInput> = (modelID, settings) =>
  configure(config(settings)).messages(modelID)
export const decisionModel = (modelID: string, settings: Settings) => {
  const input = config(settings)
  return configure(input).decision(modelID, input.providerOptions)
}

function config({
  accountId,
  apiKey,
  baseURL: configuredBaseURL,
  body,
  cacheKey,
  cacheTtl,
  collectLog,
  gatewayApiKey,
  gatewayId,
  headers,
  metadata,
  skipCache,
  ...providerOptions
}: Settings) {
  const connection = configuredBaseURL === undefined ? { accountId: accountId ?? "" } : { baseURL: configuredBaseURL }
  return {
    ...connection,
    apiKey,
    cacheKey,
    cacheTtl,
    collectLog,
    gatewayApiKey,
    gatewayId,
    headers,
    http: body === undefined ? undefined : { body },
    metadata,
    providerOptions,
    skipCache,
  }
}

export * as CloudflareAIGateway from "./cloudflare-ai-gateway.js"
