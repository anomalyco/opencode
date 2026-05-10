import type { Config, Redacted } from "effect"
import { type ModelInput } from "../llm"
import { Provider } from "../provider"
import * as OpenAICompatibleChat from "../protocols/openai-compatible-chat"
import { Auth } from "../route/auth"
import { AuthOptions, type AtLeastOne, type ProviderAuthOption } from "../route/auth-options"
import { Route } from "../route/client"
import { ProviderID, type ModelID } from "../schema"

export const aiGatewayID = ProviderID.make("cloudflare-ai-gateway")
export const workersAIID = ProviderID.make("cloudflare-workers-ai")
export const id = aiGatewayID
export const aiGatewayAuthEnvVars = ["CLOUDFLARE_API_TOKEN", "CF_AIG_TOKEN"] as const
export const workersAIAuthEnvVars = ["CLOUDFLARE_API_KEY", "CLOUDFLARE_WORKERS_AI_TOKEN"] as const

type CloudflareSecret = string | Redacted.Redacted<string> | Config.Config<string | Redacted.Redacted<string>>

type GatewayURL = AtLeastOne<{
  readonly accountId: string
  readonly baseURL: string
}> & {
  readonly gatewayId?: string
}

export type AIGatewayOptions = GatewayURL &
  Omit<ModelInput, "id" | "provider" | "route" | "baseURL" | "apiKey" | "auth"> &
  ProviderAuthOption<"optional"> & {
    /** Cloudflare AI Gateway authentication token. Sent as `cf-aig-authorization`. */
    readonly gatewayApiKey?: CloudflareSecret
  }

type AIGatewayInput = AIGatewayOptions & Pick<ModelInput, "id">

type WorkersAIURL = AtLeastOne<{
  readonly accountId: string
  readonly baseURL: string
}>

export type WorkersAIOptions = WorkersAIURL &
  Omit<ModelInput, "id" | "provider" | "route" | "baseURL" | "apiKey" | "auth"> &
  ProviderAuthOption<"optional">

type WorkersAIInput = WorkersAIOptions & Pick<ModelInput, "id">

export const aiGatewayBaseURL = (input: GatewayURL) => {
  if (input.baseURL) return input.baseURL
  if (!input.accountId) throw new Error("Cloudflare.aiGateway requires accountId unless baseURL is supplied")
  return `https://gateway.ai.cloudflare.com/v1/${encodeURIComponent(input.accountId)}/${encodeURIComponent(input.gatewayId?.trim() || "default")}/compat`
}

const aiGatewayAuth = (input: AIGatewayInput) => {
  if ("auth" in input && input.auth) return input.auth
  const gateway = Auth.optional(input.gatewayApiKey, "gatewayApiKey")
    .orElse(Auth.config("CLOUDFLARE_API_TOKEN"))
    .orElse(Auth.config("CF_AIG_TOKEN"))
    .pipe(Auth.bearerHeader("cf-aig-authorization"))
  if (!("apiKey" in input) || input.apiKey === undefined) return gateway
  if (input.gatewayApiKey === undefined) return Auth.bearer(input.apiKey)
  return Auth.bearerHeader("cf-aig-authorization", input.gatewayApiKey).andThen(Auth.bearer(input.apiKey))
}

export const workersAIBaseURL = (input: WorkersAIURL) => {
  if (input.baseURL) return input.baseURL
  if (!input.accountId) throw new Error("Cloudflare.workersAI requires accountId unless baseURL is supplied")
  return `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(input.accountId)}/ai/v1`
}

const workersAIAuth = (input: WorkersAIInput) => {
  return AuthOptions.bearer(input, workersAIAuthEnvVars)
}

export const aiGatewayRoute = OpenAICompatibleChat.route.with({
  id: "cloudflare-ai-gateway",
  provider: aiGatewayID,
})

export const workersAIRoute = OpenAICompatibleChat.route.with({
  id: "cloudflare-workers-ai",
  provider: workersAIID,
})

export const routes = [aiGatewayRoute, workersAIRoute]

const aiGatewayModel = Route.model<AIGatewayInput>(
  aiGatewayRoute,
  {
    provider: id,
  },
  {
    mapInput: (input) => {
      const {
        accountId: _accountId,
        gatewayId: _gatewayId,
        apiKey: _apiKey,
        gatewayApiKey: _gatewayApiKey,
        auth: _auth,
        ...rest
      } = input
      return {
        ...rest,
        auth: aiGatewayAuth(input),
        baseURL: aiGatewayBaseURL(input),
      }
    },
  },
)

const workersAIModel = Route.model<WorkersAIInput>(
  workersAIRoute,
  {
    provider: workersAIID,
  },
  {
    mapInput: (input) => {
      const { accountId: _accountId, apiKey: _apiKey, auth: _auth, ...rest } = input
      return {
        ...rest,
        auth: workersAIAuth(input),
        baseURL: workersAIBaseURL(input),
      }
    },
  },
)

export const aiGateway = (modelID: string | ModelID, options: AIGatewayOptions) =>
  aiGatewayModel({ ...options, id: modelID })

export const workersAI = (modelID: string | ModelID, options: WorkersAIOptions) =>
  workersAIModel({ ...options, id: modelID })

export const model = aiGateway

export const provider = Provider.make({
  id,
  model,
  apis: { aiGateway, workersAI },
})

export const apis = provider.apis
