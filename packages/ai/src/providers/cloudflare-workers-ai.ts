import type { ProviderPackage } from "../provider-package.js"
import { CloudflareRunExtraction } from "../experimental/cloudflare-run-extraction.js"
import { CloudflareRunDecisions } from "../protocols/cloudflare-run-decisions.js"
import { CloudflareWorkersAIImages } from "../protocols/cloudflare-workers-ai-images.js"
import { OpenAIChat } from "../protocols/openai-chat.js"
import { Provider } from "../provider.js"
import { AuthOptions, type AtLeastOne, type ProviderAuthOption } from "../route/auth-options.js"
import { MediaRoute } from "../route/media.js"
import { mergeTransport, ProviderID, type ModelID, type ProviderOptions, type RequestOptions } from "../schema/index.js"
import type { OpenAIProviderOptionsInput } from "./openai-options.js"
import { CloudflareShared } from "./cloudflare-shared.js"

export const id = ProviderID.make("cloudflare-workers-ai")
export const authEnvVars = ["CLOUDFLARE_API_KEY", "CLOUDFLARE_WORKERS_AI_TOKEN", "CLOUDFLARE_API_TOKEN"] as const

type WorkersAIURL = AtLeastOne<{
  readonly accountId: string
  readonly baseURL: string
}>

/** Connection settings for Workers AI's media models. Language models come from `cloudflareWorkersAI`. */
export type Config = WorkersAIURL &
  Omit<RequestOptions, "providerOptions"> &
  ProviderAuthOption<"optional"> & {
    readonly providerOptions?: OpenAIProviderOptionsInput
  }

export type Settings = ProviderPackage.Settings &
  OpenAIProviderOptionsInput &
  WorkersAIURL & {
    readonly apiKey?: string | false
  }

export type { CloudflareWorkersAIImageOptions } from "../protocols/cloudflare-workers-ai-images.js"

export const baseURL = (input: Partial<WorkersAIURL>) => CloudflareShared.baseURL(input, id, "CloudflareWorkersAI")

/** The Run API (`/ai/run`) next to the OpenAI-compatible `/ai/v1` base. */
export const runBaseURL = (input: Partial<WorkersAIURL>) =>
  CloudflareShared.runBaseURL(input, id, "CloudflareWorkersAI")

export const chatCompletions = OpenAIChat.api.extend({ id: "cloudflare-workers-ai" })

/** Workers AI's OpenAI-compatible API. Flat settings take `accountId` in place of a `baseURL`. */
export const cloudflareWorkersAI = Provider.make({
  id,
  auth: Provider.apiKey(authEnvVars),
  apis: [chatCompletions],
  settings: {
    keys: ["accountId", "baseURL"],
    patch: (values: Partial<WorkersAIURL>) => ({ baseURL: baseURL(values) }),
  },
})

export const model = Provider.entrypoint<Settings, OpenAIProviderOptionsInput>(cloudflareWorkersAI)

export const media = (input: Config) => {
  const { accountId: _accountId, apiKey: _apiKey, auth: _auth, baseURL: _baseURL, ...defaults } = input
  const auth = AuthOptions.bearer(input, authEnvVars)
  // The Run API base is derived per call so a configuration with only a custom chat base still constructs.
  const runDeployment = () => MediaRoute.deployment({ ...defaults, baseURL: runBaseURL(input) }, auth)
  return {
    decision: (modelID: string | ModelID, providerOptions?: ProviderOptions) =>
      CloudflareRunDecisions.route
        .with({
          provider: id,
          endpoint: { baseURL: runBaseURL(input) },
          auth,
          ...mergeTransport(input),
        })
        .model({ id: modelID, providerOptions }),
    image: (modelID: string | ModelID, providerOptions?: ProviderOptions) =>
      CloudflareWorkersAIImages.model({ ...runDeployment(), id: modelID, providerOptions }),
    experimental: {
      extraction: (modelID: string | ModelID) => CloudflareRunExtraction.model({ ...runDeployment(), id: modelID }),
    },
  }
}

export const imageModel = (modelID: string, settings: Settings) => {
  const input = config(settings)
  return media(input).image(modelID, input.providerOptions)
}
export const decisionModel = (modelID: string, settings: Settings) => {
  const input = config(settings)
  return media(input).decision(modelID, input.providerOptions)
}

function config(settings: Settings) {
  const { accountId: _, apiKey, baseURL: _url, body, headers, ...providerOptions } = settings
  return {
    apiKey,
    baseURL: baseURL(settings),
    headers,
    http: body === undefined ? undefined : { body },
    providerOptions,
  }
}

export * as CloudflareWorkersAI from "./cloudflare-workers-ai.js"
