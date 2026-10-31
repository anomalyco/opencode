import { ProviderID, type ModelID, type ProviderOptions } from "../schema/index.js"
import type { ProviderPackage } from "../provider-package.js"
import { AuthOptions, type ProviderAuthOption } from "../route/auth-options.js"
import type { RouteDefaultsInput } from "../route/client.js"
import { AnthropicMessages } from "../protocols/anthropic-messages.js"
import { Gemini } from "../protocols/gemini.js"
import { OpenAICompatibleChat } from "../protocols/openai-compatible-chat.js"
import { OpenAIResponses } from "../protocols/openai-responses.js"
import { SystemOne } from "../protocols/system-one.js"
import { withOpenAIOptions, type OpenAIProviderOptionsInput } from "./openai-options.js"

export const id = ProviderID.make("opencode")

// Zen serves each model over one API family: https://opencode.ai/v2/docs/console/api/inference/
const baseURLs = {
  openai: "https://opencode.ai/inference/openai/v1",
  anthropic: "https://opencode.ai/inference/anthropic/v1",
  google: "https://opencode.ai/inference/google/v1beta",
  systemone: "https://opencode.ai/inference/systemone/v1",
}

export type ChatOptionsInput = OpenAIProviderOptionsInput
export type ResponsesOptionsInput = OpenAIProviderOptionsInput
export type MessagesOptionsInput = AnthropicMessages.ProviderOptionsInput
export type GeminiOptionsInput = Gemini.ProviderOptionsInput

export type Config = Omit<RouteDefaultsInput, "providerOptions"> &
  ProviderAuthOption<"optional"> & {
    /** Overrides the selected API's base URL, including its version prefix. */
    readonly baseURL?: string
    readonly providerOptions?: ProviderOptions
  }

export type Settings<Options = {}> = ProviderPackage.Settings &
  Options & {
    readonly apiKey?: string | false
    readonly baseURL?: string
  }

const chatRoute = OpenAICompatibleChat.route.with({ id: "opencode-chat", provider: id })
const responsesRoute = OpenAIResponses.route.with({ id: "opencode-responses", provider: id })
const messagesRoute = AnthropicMessages.route.with({ id: "opencode-messages", provider: id })
const geminiRoute = Gemini.route.with({ id: "opencode-gemini", provider: id })

export const routes = [chatRoute, responsesRoute, messagesRoute, geminiRoute]

export const configure = (input: Config = {}) => {
  const { apiKey: _apiKey, auth: _auth, baseURL, ...defaults } = input
  // Zen documents bearer auth for every API family.
  const auth = AuthOptions.bearer(input, "OPENCODE_API_KEY")
  const endpoint = (fallback: string) => ({ baseURL: baseURL ?? fallback })
  const chat = (modelID: string | ModelID) =>
    chatRoute.with({ ...defaults, endpoint: endpoint(baseURLs.openai), auth }).model<ChatOptionsInput>({ id: modelID })
  const responses = (modelID: string | ModelID) =>
    responsesRoute
      .with({ ...withOpenAIOptions(String(modelID), defaults), endpoint: endpoint(baseURLs.openai), auth })
      .model<ResponsesOptionsInput>({ id: modelID })
  const messages = (modelID: string | ModelID) =>
    messagesRoute
      .with({ ...defaults, endpoint: endpoint(baseURLs.anthropic), auth })
      .model<MessagesOptionsInput>({ id: modelID })
  const gemini = (modelID: string | ModelID) =>
    geminiRoute
      .with({ ...defaults, endpoint: endpoint(baseURLs.google), auth })
      .model<GeminiOptionsInput>({ id: modelID })
  const decisionRoute = SystemOne.route.with({
    provider: id,
    providerMetadataKey: "opencode",
    endpoint: endpoint(baseURLs.systemone),
    auth,
    // Zen forwards TypeSafe's image opt-in header; text-only requests are unchanged with it.
    headers: { "TypeSafe-Danger-Zone-Images": "true", ...input.headers },
    http: input.http,
  })
  const decision = (modelID: string | ModelID, providerOptions?: ProviderOptions) =>
    decisionRoute.model({ id: modelID, providerOptions })
  return { id, model: chat, chat, responses, messages, gemini, decision, configure }
}

export const provider = configure()

export const model: ProviderPackage.Model<Settings<ChatOptionsInput>, ChatOptionsInput> = (modelID, settings) =>
  configure(config(settings)).chat(modelID)
export const responsesModel: ProviderPackage.Model<
  Settings<ResponsesOptionsInput>,
  ResponsesOptionsInput,
  typeof OpenAIResponses.route.compact
> = (modelID, settings) => configure(config(settings)).responses(modelID)
export const messagesModel: ProviderPackage.Model<Settings<MessagesOptionsInput>, MessagesOptionsInput> = (
  modelID,
  settings,
) => configure(config(settings)).messages(modelID)
export const geminiModel: ProviderPackage.Model<Settings<GeminiOptionsInput>, GeminiOptionsInput> = (
  modelID,
  settings,
) => configure(config(settings)).gemini(modelID)
export const decisionModel = (modelID: string, settings?: Settings) => {
  const input = config(settings)
  return configure(input).decision(modelID, input.providerOptions)
}

export const chat = provider.chat
export const responses = provider.responses
export const messages = provider.messages
export const gemini = provider.gemini
export const decision = provider.decision

function config({ apiKey, baseURL, body, headers, ...providerOptions }: Settings = {}) {
  return {
    apiKey,
    baseURL,
    headers,
    http: body === undefined ? undefined : { body },
    providerOptions,
  }
}

export * as OpenCode from "./opencode.js"
