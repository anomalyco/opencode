import { Schema, type Config, type Redacted } from "effect"
import type { ProviderPackage } from "../provider-package.js"
import { AnthropicMessages, OpenAIChat, OpenAIResponses } from "../protocols/index.js"
import { Auth } from "../route/auth.js"
import type { AtLeastOne, ProviderAuthOption } from "../route/auth-options.js"
import type { RouteDefaultsInput } from "../route/client.js"
import { ProviderConfigurationError, ProviderID, type ModelID } from "../schema/index.js"
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

export type LanguageModelOptions = GatewayURL &
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
    readonly apiKey?: string
    readonly gatewayApiKey?: string
  }

export const baseURL = (input: GatewayURL) => {
  if (input.baseURL) return input.baseURL
  return `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(requireAccountId(input))}/ai/v1`
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

const credential = (input: LanguageModelOptions) =>
  Auth.optional(input.gatewayApiKey ?? ("apiKey" in input ? input.apiKey : undefined), "apiKey")
    .orElse(Auth.config(authEnvVars[0]))
    .orElse(Auth.config(authEnvVars[1]))

const headers = (input: LanguageModelOptions) => ({
  ...(input.metadata === undefined
    ? {}
    : { "cf-aig-metadata": Schema.encodeSync(Schema.fromJsonString(Schema.Unknown))(input.metadata) }),
  ...(input.cacheTtl === undefined ? {} : { "cf-aig-cache-ttl": String(input.cacheTtl) }),
  ...(input.cacheKey === undefined ? {} : { "cf-aig-cache-key": input.cacheKey }),
  ...(input.skipCache === undefined ? {} : { "cf-aig-skip-cache": String(input.skipCache) }),
  ...(input.collectLog === undefined ? {} : { "cf-aig-collect-log": String(input.collectLog) }),
  ...input.headers,
})

export const configure = (input: LanguageModelOptions) => {
  const custom = "auth" in input && input.auth ? input.auth : undefined
  const rest = {
    endpoint: { baseURL: baseURL(input) },
    auth: custom ?? credential(input).bearer(),
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
          auth: custom ?? Auth.bearerHeader("cf-aig-authorization", credential(input)),
          headers: headers(input),
        }
      : rest
  const responses = responsesRoute.with(passthrough("openai"))
  const messages = messagesRoute.with(passthrough("anthropic/v1"))
  const chat = route.with(rest)
  return {
    id,
    model: (input: string | ModelID) => {
      const value = String(input)
      if (value.startsWith("openai/"))
        return responses.model<OpenAIProviderOptionsInput>({ id: native ? value.slice("openai/".length) : value })
      if (value.startsWith("anthropic/"))
        return messages.model<OpenAIProviderOptionsInput>({
          id: native ? value.slice("anthropic/".length).replaceAll(".", "-") : value,
        })
      if (value.startsWith("workers-ai/"))
        return chat.model<OpenAIProviderOptionsInput>({ id: value.slice("workers-ai/".length) })
      return chat.model<OpenAIProviderOptionsInput>({ id: value })
    },
    configure,
  }
}

export const provider = { id, configure }

export const model: ProviderPackage.Definition<Settings, OpenAIProviderOptionsInput>["model"] = (
  modelID,
  {
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
  },
) => {
  const connection = configuredBaseURL === undefined ? { accountId: accountId ?? "" } : { baseURL: configuredBaseURL }
  return configure({
    ...connection,
    apiKey,
    cacheKey,
    cacheTtl,
    collectLog,
    gatewayApiKey,
    gatewayId,
    headers: headers === undefined ? undefined : { ...headers },
    http: body === undefined ? undefined : { body: { ...body } },
    metadata,
    providerOptions,
    skipCache,
  }).model(modelID)
}

export * as CloudflareAIGateway from "./cloudflare-ai-gateway.js"
