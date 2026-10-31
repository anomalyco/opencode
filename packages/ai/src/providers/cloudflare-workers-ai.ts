import type { ProviderPackage } from "../provider-package.js"
import { CloudflareRunExtraction } from "../experimental/cloudflare-run-extraction.js"
import { CloudflareRunDecisions } from "../protocols/cloudflare-run-decisions.js"
import { CloudflareWorkersAIImages } from "../protocols/cloudflare-workers-ai-images.js"
import { OpenAIChat } from "../protocols/openai-chat.js"
import { AuthOptions, type AtLeastOne, type ProviderAuthOption } from "../route/auth-options.js"
import { Route, type RouteDefaultsInput } from "../route/client.js"
import { Endpoint } from "../route/endpoint.js"
import { MediaRoute } from "../route/media.js"
import { ProviderConfigurationError, ProviderID, type ModelID, type ProviderOptions } from "../schema/index.js"
import type { OpenAIProviderOptionsInput } from "./openai-options.js"
import { config } from "./cloudflare-workers-ai-settings.js"

const id = ProviderID.make("cloudflare-workers-ai")
export const authEnvVars = ["CLOUDFLARE_API_KEY", "CLOUDFLARE_WORKERS_AI_TOKEN", "CLOUDFLARE_API_TOKEN"] as const

type WorkersAIURL = AtLeastOne<{
  readonly accountId: string
  readonly baseURL: string
}>

export type Config = WorkersAIURL &
  Omit<RouteDefaultsInput, "providerOptions"> &
  ProviderAuthOption<"optional"> & {
    readonly providerOptions?: OpenAIProviderOptionsInput
  }

export type Settings = ProviderPackage.Settings &
  OpenAIProviderOptionsInput &
  WorkersAIURL & {
    readonly apiKey?: string | false
  }

export type { CloudflareWorkersAIImageOptions } from "../protocols/cloudflare-workers-ai-images.js"

export const baseURL = (input: WorkersAIURL) => {
  if (input.baseURL) return input.baseURL
  if (!input.accountId)
    throw new ProviderConfigurationError({
      provider: id,
      message: "cloudflareWorkersAI.configure requires accountId unless baseURL is supplied",
    })
  return `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(input.accountId)}/ai/v1`
}

/** The Run API (`/ai/run`) next to the OpenAI-compatible `/ai/v1` base. */
export const runBaseURL = (input: WorkersAIURL) => {
  const url = Endpoint.trimBaseUrl(baseURL(input))
  if (!url.endsWith("/ai/v1"))
    throw new ProviderConfigurationError({
      provider: id,
      message: "CloudflareWorkersAI needs accountId or a baseURL ending in /ai/v1 to derive the Run API base",
    })
  return `${url.slice(0, -"/v1".length)}/run`
}

export const route = Route.make({
  id: "cloudflare-workers-ai",
  provider: id,
  providerMetadataKey: "cloudflare-workers-ai",
  protocol: OpenAIChat.protocol,
  endpoint: Endpoint.path("/chat/completions"),
  framing: OpenAIChat.framing,
})

export const routes = [route]

const configure = (input: Config) => {
  const { accountId: _accountId, apiKey: _apiKey, auth: _auth, baseURL: _baseURL, ...defaults } = input
  const auth = AuthOptions.bearer(input, authEnvVars)
  const configured = route.with({ ...defaults, endpoint: { baseURL: baseURL(input) }, auth })
  // The Run API base is derived per call so a chat-only configuration without an account still constructs.
  const runDeployment = () => MediaRoute.deployment({ ...input, baseURL: runBaseURL(input) }, auth)
  const decision = (modelID: string | ModelID, providerOptions?: ProviderOptions) =>
    CloudflareRunDecisions.route
      .with({
        provider: id,
        endpoint: { baseURL: runBaseURL(input) },
        auth: auth,
        headers: input.headers,
        http: input.http,
      })
      .model({ id: modelID, providerOptions })
  return Object.assign((modelID: string | ModelID) => configured.model<OpenAIProviderOptionsInput>({ id: modelID }), {
    id,
    decision,
    image: (modelID: string | ModelID, providerOptions?: ProviderOptions) =>
      CloudflareWorkersAIImages.model({ ...runDeployment(), id: modelID, providerOptions }),
    experimental: {
      extraction: (modelID: string | ModelID) => CloudflareRunExtraction.model({ ...runDeployment(), id: modelID }),
    },
    configure,
  })
}

export const cloudflareWorkersAI = Object.assign(
  (modelID: string | ModelID, input: Config) => configure(input)(modelID),
  { id, configure },
)

export const model: ProviderPackage.Model<Settings, OpenAIProviderOptionsInput> = (modelID, settings) =>
  configure(config(settings))(modelID)
