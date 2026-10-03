import type { ProviderPackage } from "../provider-package.js"
import { ModelNames } from "../model-names.js"
import { AnthropicMessages } from "../protocols/anthropic-messages.js"
import { OpenAIChat } from "../protocols/openai-chat.js"
import { OpenAIResponses } from "../protocols/openai-responses.js"
import { cacheControl } from "../protocols/utils/cache.js"
import { AuthOptions, type ProviderAuthOption } from "../route/auth-options.js"
import { Route, type RouteDefaultsInput } from "../route/client.js"
import { Endpoint } from "../route/endpoint.js"
import { Framing } from "../route/framing.js"
import { Protocol } from "../route/protocol.js"
import { ProviderID, type ModelID } from "../schema/index.js"
import type { OpenAIProviderOptionsInput } from "./openai-options.js"

export const id = ProviderID.make("digitalocean")
const baseURL = "https://inference.do-ai.run/v1"

export type LanguageModelOptions = Omit<RouteDefaultsInput, "providerOptions"> &
  ProviderAuthOption<"optional"> & {
    readonly baseURL?: string
    readonly providerOptions?: OpenAIProviderOptionsInput | AnthropicMessages.OptionsInput
  }

export type Settings<Options = OpenAIProviderOptionsInput | AnthropicMessages.OptionsInput> = ProviderPackage.Settings &
  Options & { readonly apiKey?: string }

export const protocol = Protocol.make({
  id: "digitalocean-chat",
  body: {
    schema: OpenAIChat.protocol.body.schema,
    from: (request) => OpenAIChat.fromRequest(request, { cacheControl: cacheControl() }),
  },
  stream: OpenAIChat.protocol.stream,
})

export const route = Route.make({
  id: "digitalocean",
  provider: id,
  providerMetadataKey: "digitalocean",
  protocol,
  endpoint: Endpoint.path("/chat/completions", { baseURL }),
  framing: OpenAIChat.framing,
})

const messagesRoute = Route.make({
  id: "digitalocean-messages",
  provider: id,
  providerMetadataKey: "digitalocean",
  protocol: AnthropicMessages.protocol,
  endpoint: Endpoint.path("/messages", { baseURL }),
  transport: AnthropicMessages.transport<AnthropicMessages.AnthropicMessagesBody>(),
  headers: () => ({ "anthropic-version": "2023-06-01" }),
})

const responsesRoute = Route.make({
  id: "digitalocean-responses",
  provider: id,
  providerMetadataKey: "digitalocean",
  protocol: OpenAIResponses.protocol,
  endpoint: Endpoint.path("/responses", { baseURL }),
  framing: Framing.sse,
})

export const routes = [route, messagesRoute, responsesRoute]

export const configure = (input: LanguageModelOptions = {}) => {
  const { apiKey: _apiKey, auth: _auth, baseURL: endpoint, ...rest } = input
  const defaults = {
    ...rest,
    endpoint: { baseURL: endpoint ?? baseURL },
    auth: AuthOptions.bearer(input, ["DIGITALOCEAN_ACCESS_TOKEN", "DIGITALOCEAN_API_KEY", "DO_INFERENCE_API_KEY"]),
  }
  const reasoningEffort = input.providerOptions?.reasoningEffort ?? input.providerOptions?.effort
  const chat = (modelID: string | ModelID) =>
    route
      .with({ ...defaults, providerOptions: { ...input.providerOptions, reasoningEffort } })
      .model<OpenAIProviderOptionsInput>({
        id: modelID,
        compatibility: { supportsPromptCacheKey: true },
      })
  const messages = (modelID: string | ModelID) =>
    messagesRoute
      .with({
        ...defaults,
        providerOptions: {
          ...input.providerOptions,
          effort: input.providerOptions?.effort ?? input.providerOptions?.reasoningEffort,
        },
      })
      .model<AnthropicMessages.OptionsInput>({
        id: modelID,
        // DigitalOcean rejects the native chronological effort marker even with the beta header.
        compatibility: { supportsEffortUpdates: false },
      })
  const responses = (modelID: string | ModelID) =>
    responsesRoute
      .with({
        ...defaults,
        providerOptions: {
          store: false,
          reasoningSummary: "auto",
          include: ["reasoning.encrypted_content"],
          ...input.providerOptions,
          reasoningEffort,
        },
      })
      .model<OpenAIProviderOptionsInput>({ id: modelID })
  const model = (modelID: string | ModelID) =>
    ModelNames.isAnthropic(modelID) ? messages(modelID) : responses(modelID)
  return { id, model, chat, messages, responses, configure }
}

export const provider = configure()

export const model: ProviderPackage.Definition<Settings>["model"] = (
  modelID,
  { apiKey, baseURL, body, headers, ...providerOptions },
) =>
  configure({
    apiKey,
    baseURL,
    headers,
    http: { body },
    providerOptions,
  }).model(modelID)

export * as DigitalOcean from "./digitalocean.js"
