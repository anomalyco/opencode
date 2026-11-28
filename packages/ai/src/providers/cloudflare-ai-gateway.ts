import type { Config, Redacted } from "effect"
import type { ProviderPackage } from "../provider-package.js"
import { CloudflareRunDecisions } from "../protocols/cloudflare-run-decisions.js"
import { AnthropicMessages, OpenAIChat, OpenAIResponses } from "../protocols/index.js"
import type { AnyApi } from "../api.js"
import { Provider } from "../provider.js"
import { Auth } from "../route/auth.js"
import { AuthOptions, type AtLeastOne, type ProviderAuthOption } from "../route/auth-options.js"
import { mergeTransport, ProviderID, type ModelID, type ProviderOptions, type RequestOptions } from "../schema/index.js"
import { encodeJson } from "../utils/json.js"
import type { OpenAIProviderOptionsInput } from "./openai-options.js"
import { CloudflareShared } from "./cloudflare-shared.js"

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

/** Connection settings for the Gateway's decision models. Language models come from `model`. */
export type MediaConfig = GatewayURL &
  GatewayOptions &
  Omit<RequestOptions, "providerOptions"> &
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

export const baseURL = (input: Partial<GatewayURL>) => CloudflareShared.baseURL(input, id, "CloudflareAIGateway")

/** The Run API (`/ai/run`) next to the OpenAI-compatible `/ai/v1` base. */
export const runBaseURL = (input: Partial<GatewayURL>) => CloudflareShared.runBaseURL(input, id, "CloudflareAIGateway")

// Cloudflare's REST API rejects parts of the Anthropic Messages and OpenAI Responses request shapes, such as
// system prompt blocks and `minimal` reasoning effort, so these models use the provider-native gateway endpoints.
const passthroughURL = (input: Partial<GatewayURL> & GatewayOptions, provider: "anthropic/v1" | "openai") =>
  `https://gateway.ai.cloudflare.com/v1/${encodeURIComponent(CloudflareShared.requireAccountId(input, id, "CloudflareAIGateway"))}/${encodeURIComponent(gatewayId(input))}/${provider}`

const gatewayId = (input: GatewayOptions) => input.gatewayId?.trim() || "default"

export const responses = OpenAIResponses.api.extend({ id: "cloudflare-ai-gateway-responses" })

export const messages = AnthropicMessages.api.extend({ id: "cloudflare-ai-gateway-messages" })

export const chatCompletions = OpenAIChat.api.extend({ id: "cloudflare-ai-gateway-chat" })

const credential = (
  input: Pick<MediaConfig, "gatewayApiKey"> & ProviderAuthOption<"optional">,
  apply: (credential: Auth.Credential) => Auth.Definition,
) =>
  AuthOptions.apiKey(
    { apiKey: input.gatewayApiKey ?? ("apiKey" in input ? input.apiKey : undefined) },
    authEnvVars,
    apply,
  )

const gatewayHeaders = (input: GatewayOptions) => ({
  ...(input.metadata === undefined ? {} : { "cf-aig-metadata": encodeJson(input.metadata) }),
  ...(input.cacheTtl === undefined ? {} : { "cf-aig-cache-ttl": String(input.cacheTtl) }),
  ...(input.cacheKey === undefined ? {} : { "cf-aig-cache-key": input.cacheKey }),
  ...(input.skipCache === undefined ? {} : { "cf-aig-skip-cache": String(input.skipCache) }),
  ...(input.collectLog === undefined ? {} : { "cf-aig-collect-log": String(input.collectLog) }),
})

const gatewayKeys = [
  "accountId",
  "gatewayId",
  "metadata",
  "cacheTtl",
  "cacheKey",
  "skipCache",
  "collectLog",
  "gatewayApiKey",
]

/**
 * A model on one API. Claude and OpenAI models go to the provider-native gateway endpoint without their vendor prefix;
 * a custom baseURL stands in for the REST API, so every model keeps using it with gateway model IDs.
 */
const serve =
  (api: AnyApi, passthrough?: { readonly path: "anthropic/v1" | "openai"; readonly modelID: (id: string) => string }) =>
  (modelID: string, settings: Settings) => {
    const native = passthrough !== undefined && settings.baseURL === undefined
    const provider = Provider.make({
      id,
      baseURL: native ? passthroughURL(settings, passthrough.path) : baseURL(settings),
      auth: Provider.custom(
        credential(settings, native ? Auth.bearerHeader("cf-aig-authorization") : (credential) => credential.bearer()),
      ),
      apis: [api],
      settings: {
        keys: gatewayKeys,
        patch: (values: GatewayOptions) => ({
          headers: native
            ? gatewayHeaders(values)
            : { "cf-aig-gateway-id": gatewayId(values), ...gatewayHeaders(values) },
        }),
      },
    })
    return Provider.entrypoint<Settings, OpenAIProviderOptionsInput>(provider)(
      native ? passthrough.modelID(modelID) : modelID,
      settings,
    )
  }

export const responsesModel = serve(responses, { path: "openai", modelID: (value) => value.replace(/^openai\//, "") })
export const messagesModel = serve(messages, {
  path: "anthropic/v1",
  modelID: (value) => value.replace(/^anthropic\//, "").replaceAll(".", "-"),
})
const chatServe = serve(chatCompletions)
export const chatModel = (modelID: string, settings: Settings) =>
  chatServe(modelID.replace(/^workers-ai\//, ""), settings)

export const model = (modelID: string, settings: Settings) => {
  if (modelID.startsWith("openai/")) return responsesModel(modelID, settings)
  if (modelID.startsWith("anthropic/")) return messagesModel(modelID, settings)
  return chatModel(modelID, settings)
}

export const media = (input: MediaConfig) => {
  const custom = "auth" in input && input.auth ? input.auth : undefined
  return {
    // The Run API base is derived per call so a chat-only configuration without an account still constructs.
    decision: (value: string | ModelID, providerOptions?: ProviderOptions) =>
      CloudflareRunDecisions.route
        .with({
          provider: id,
          endpoint: { baseURL: runBaseURL(input) },
          auth: custom ?? credential(input, (credential) => credential.bearer()),
          ...mergeTransport(input, {
            headers: { "cf-aig-gateway-id": gatewayId(input), ...gatewayHeaders(input), ...input.headers },
          }),
        })
        .model({ id: value, providerOptions }),
  }
}

export const decisionModel = (modelID: string, settings: Settings) => {
  const {
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
  } = settings
  const connection = configuredBaseURL === undefined ? { accountId: accountId ?? "" } : { baseURL: configuredBaseURL }
  return media({
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
    skipCache,
  }).decision(modelID, providerOptions)
}

export * as CloudflareAIGateway from "./cloudflare-ai-gateway.js"
