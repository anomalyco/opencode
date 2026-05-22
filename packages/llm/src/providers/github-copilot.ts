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

const configuredResponsesRoute = (options: ModelOptions) =>
  responsesRoute.with({
    endpoint: { baseURL: options.baseURL },
    auth: AuthOptions.bearer(options, []),
  })

const configuredChatRoute = (options: ModelOptions) =>
  chatRoute.with({
    endpoint: { baseURL: options.baseURL },
    auth: AuthOptions.bearer(options, []),
  })

export const configure = (options: ModelOptions) => {
  const responsesRoute = configuredResponsesRoute(options)
  const chatRoute = configuredChatRoute(options)
  const responses = (modelID: string | ModelID) =>
    responsesRoute.with(withOpenAIOptions(modelID, defaults(options))).model({ id: modelID })
  const chat = (modelID: string | ModelID) =>
    chatRoute.with(withOpenAIOptions(modelID, defaults(options))).model({ id: modelID })
  return {
    id,
    model: (modelID: string | ModelID) => (shouldUseResponsesApi(modelID) ? responses(modelID) : chat(modelID)),
    responses,
    chat,
    configure,
  }
}

export const provider = {
  id,
  configure,
}
