import { Schema, type Config, type Redacted } from "effect"
import type { ProviderPackage } from "../provider-package.js"
import { AnthropicMessages, OpenAIChat, OpenAIResponses } from "../protocols/index.js"
import { Auth } from "../route/auth.js"
import type { AtLeastOne, ProviderAuthOption } from "../route/auth-options.js"
import type { RouteDefaultsInput } from "../route/client.js"
import { ProviderConfigurationError, ProviderID, type ModelID } from "../schema/index.js"
import type { OpenAIProviderOptionsInput } from "./openai-options.js"
import { ModelRef } from "../model-ref.js"

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
  if (!input.accountId)
    throw new ProviderConfigurationError({
      provider: id,
      message: "CloudflareAIGateway.configure requires accountId unless baseURL is supplied",
    })
  return `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(input.accountId)}/ai/v1`
}

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

const auth = (input: LanguageModelOptions) => {
  if ("auth" in input && input.auth) return input.auth
  return Auth.optional(input.gatewayApiKey ?? ("apiKey" in input ? input.apiKey : undefined), "apiKey")
    .orElse(Auth.config(authEnvVars[0]))
    .orElse(Auth.config(authEnvVars[1]))
    .bearer()
}

const headers = (input: LanguageModelOptions) => ({
  ...(input.gatewayId === undefined ? {} : { "cf-aig-gateway-id": input.gatewayId.trim() || "default" }),
  ...(input.metadata === undefined
    ? {}
    : { "cf-aig-metadata": Schema.encodeSync(Schema.fromJsonString(Schema.Unknown))(input.metadata) }),
  ...(input.cacheTtl === undefined ? {} : { "cf-aig-cache-ttl": String(input.cacheTtl) }),
  ...(input.cacheKey === undefined ? {} : { "cf-aig-cache-key": input.cacheKey }),
  ...(input.skipCache === undefined ? {} : { "cf-aig-skip-cache": String(input.skipCache) }),
  ...(input.collectLog === undefined ? {} : { "cf-aig-collect-log": String(input.collectLog) }),
  ...input.headers,
})

const modelID = (input: string | ModelID) => {
  const value = String(input)
  if (value.startsWith("workers-ai/")) return value.slice("workers-ai/".length)
  if (value.startsWith("anthropic/")) return `anthropic/${value.slice("anthropic/".length).replaceAll(".", "-")}`
  return value
}

export const configure = (input: LanguageModelOptions) => {
  const defaults = {
    endpoint: { baseURL: baseURL(input) },
    auth: auth(input),
    headers: headers(input),
    http: input.http,
    providerOptions: input.providerOptions,
  }
  const responses = responsesRoute.with(defaults)
  const messages = messagesRoute.with(defaults)
  const chat = route.with(defaults)
  return ModelRef.facade({
    id,
    model: (input: string | ModelID) => {
      const wire = modelID(input)
      if (String(input).startsWith("openai/")) return responses.model<OpenAIProviderOptionsInput>({ id: wire })
      if (String(input).startsWith("anthropic/")) return messages.model<OpenAIProviderOptionsInput>({ id: wire })
      return chat.model<OpenAIProviderOptionsInput>({ id: wire })
    },
    configure,
  })
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
