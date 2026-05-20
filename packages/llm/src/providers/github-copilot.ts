import { Provider } from "../provider"
import { AuthOptions, type ProviderAuthOption } from "../route/auth-options"
import type { RouteDefaultsInput } from "../route/client"
import { ProviderID, type ModelID } from "../schema"
import * as OpenAIChat from "../protocols/openai-chat"
import * as OpenAIResponses from "../protocols/openai-responses"
import { withOpenAIOptions, type OpenAIProviderOptionsInput } from "./openai-options"

export const id = ProviderID.make("github-copilot")

// GitHub Copilot has no canonical public URL — callers (opencode, etc.) must
// supply `baseURL` explicitly.
export type ModelOptions = Omit<RouteDefaultsInput, "providerOptions"> &
  ProviderAuthOption<"optional"> & {
    readonly baseURL: string
    readonly providerOptions?: OpenAIProviderOptionsInput
  }

export const shouldUseResponsesApi = (modelID: string | ModelID) => {
  const model = String(modelID)
  const match = /^gpt-(\d+)/.exec(model)
  if (!match) return false
  return Number(match[1]) >= 5 && !model.startsWith("gpt-5-mini")
}

export const routes = [OpenAIResponses.route, OpenAIChat.route]

const chatRoute = OpenAIChat.route.with({ provider: id })
const responsesRoute = OpenAIResponses.route.with({ provider: id })

const defaults = (options: ModelOptions) => {
  const { apiKey: _, auth: _auth, baseURL: _baseURL, ...rest } = options
  return rest
}

export const responses = (modelID: string | ModelID, options: ModelOptions) =>
  responsesRoute
    .with({
      ...withOpenAIOptions(modelID, defaults(options)),
      endpoint: { baseURL: options.baseURL },
      auth: AuthOptions.bearer(options, []),
    })
    .model({ id: modelID })

export const chat = (modelID: string | ModelID, options: ModelOptions) =>
  chatRoute
    .with({
      ...withOpenAIOptions(modelID, defaults(options)),
      endpoint: { baseURL: options.baseURL },
      auth: AuthOptions.bearer(options, []),
    })
    .model({ id: modelID })

export const model = (modelID: string | ModelID, options: ModelOptions) => {
  if (shouldUseResponsesApi(modelID)) return responses(modelID, options)
  return chat(modelID, options)
}

export const provider = Provider.make({
  id,
  model,
  apis: { responses, chat },
})

export const apis = provider.apis
