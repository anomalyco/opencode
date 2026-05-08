import { type ModelInput } from "../llm"
import { Provider } from "../provider"
import * as OpenAICompatibleChat from "../protocols/openai-compatible-chat"
import { Auth } from "../route/auth"
import { type ProviderAuthOption } from "../route/auth-options"
import { Route } from "../route/client"
import { ProviderID, type ModelID } from "../schema"

export const aiGatewayID = ProviderID.make("cloudflare-ai-gateway")
export const workersAIID = ProviderID.make("cloudflare-workers-ai")
export const id = aiGatewayID

type GatewayURL =
  | {
      readonly accountId: string
      readonly gatewayId?: string
      readonly baseURL?: string
    }
  | {
      readonly baseURL: string
      readonly accountId?: string
      readonly gatewayId?: string
    }

export type AIGatewayOptions = GatewayURL &
  Omit<ModelInput, "id" | "provider" | "route" | "baseURL" | "apiKey" | "auth"> &
  ProviderAuthOption<"optional">

type AIGatewayInput = AIGatewayOptions & Pick<ModelInput, "id">

type WorkersAIURL =
  | {
      readonly accountId: string
      readonly baseURL?: string
    }
  | {
      readonly baseURL: string
      readonly accountId?: string
    }

export type WorkersAIOptions = WorkersAIURL &
  Omit<ModelInput, "id" | "provider" | "route" | "baseURL" | "apiKey" | "auth"> &
  ProviderAuthOption<"optional">

type WorkersAIInput = WorkersAIOptions & Pick<ModelInput, "id">

export const aiGatewayBaseURL = (input: GatewayURL) => {
  if (input.baseURL) return input.baseURL
  if (!input.accountId) throw new Error("Cloudflare.aiGateway requires accountId unless baseURL is supplied")
  return `https://gateway.ai.cloudflare.com/v1/${encodeURIComponent(input.accountId)}/${encodeURIComponent(input.gatewayId ?? "default")}/compat`
}

const aiGatewayAuth = (input: AIGatewayInput) => {
  if ("auth" in input && input.auth) return input.auth
  return Auth.optional("apiKey" in input ? input.apiKey : undefined, "apiKey")
    .orElse(Auth.config("CLOUDFLARE_API_TOKEN"))
    .orElse(Auth.config("CF_AIG_TOKEN"))
    .bearer()
}

export const workersAIBaseURL = (input: WorkersAIURL) => {
  if (input.baseURL) return input.baseURL
  if (!input.accountId) throw new Error("Cloudflare.workersAI requires accountId unless baseURL is supplied")
  return `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(input.accountId)}/ai/v1`
}

const workersAIAuth = (input: WorkersAIInput) => {
  if ("auth" in input && input.auth) return input.auth
  return Auth.optional("apiKey" in input ? input.apiKey : undefined, "apiKey")
    .orElse(Auth.config("CLOUDFLARE_API_KEY"))
    .orElse(Auth.config("CLOUDFLARE_WORKERS_AI_TOKEN"))
    .bearer()
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
      const { accountId: _accountId, gatewayId: _gatewayId, apiKey: _apiKey, auth: _auth, ...rest } = input
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
})
