import { AuthOptions, type ProviderAuthOption } from "../route/auth-options"
import type { Route, RouteDefaultsInput } from "../route/client"
import type { ProviderPackage } from "../provider-package"
import { HttpOptions, ProviderID, ToolDefinition, mergeHttpOptions, type ModelID } from "../schema"
import * as OpenAIChat from "../protocols/openai-chat"
import * as OpenAIResponses from "../protocols/openai-responses"
import { withOpenAIOptions, type OpenAIProviderOptionsInput } from "./openai-options"
import { OpenAIImages, type OpenAIImageOptions } from "../protocols/openai-images"

export type { OpenAIOptionsInput, OpenAIResponseIncludable } from "./openai-options"
export type { OpenAIImageOptions } from "../protocols/openai-images"

export const id = ProviderID.make("openai")

export const routes = [OpenAIResponses.route, OpenAIResponses.webSocketRoute, OpenAIChat.route]

// This provider facade wraps the lower-level Responses and Chat model factories
// with OpenAI-specific conveniences: typed options, API-key sugar, env fallback,
// and default option normalization.
export type Config = RouteDefaultsInput &
  ProviderAuthOption<"optional"> & {
    readonly baseURL?: string
    readonly queryParams?: Record<string, string>
    readonly providerOptions?: OpenAIProviderOptionsInput
    readonly image?: ImageConfig
  }

export interface ImageConfig {
  readonly providerOptions?: OpenAIImageOptions
}

export interface ImageGenerationOptions {
  readonly action?: "auto" | "generate" | "edit"
  readonly background?: "auto" | "opaque" | "transparent"
  readonly inputFidelity?: "low" | "high"
  readonly outputCompression?: number
  readonly outputFormat?: "png" | "jpeg" | "webp"
  readonly partialImages?: number
  readonly quality?: "auto" | "low" | "medium" | "high"
  readonly size?: string
}

export const imageGeneration = (options: ImageGenerationOptions = {}) =>
  ToolDefinition.make({
    name: "image_generation",
    description: "Generate or edit an image using OpenAI's hosted image generation tool.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    native: {
      openai: {
        type: "image_generation",
        action: options.action,
        background: options.background,
        input_fidelity: options.inputFidelity,
        output_compression: options.outputCompression,
        output_format: options.outputFormat,
        partial_images: options.partialImages,
        quality: options.quality,
        size: options.size,
      },
    },
  })

export interface Settings extends ProviderPackage.Settings {
  readonly apiKey?: string
  readonly baseURL?: string
  readonly organization?: string
  readonly project?: string
  readonly queryParams?: Readonly<Record<string, string>>
  readonly transport?: "http" | "websocket"
  readonly providerOptions?: OpenAIProviderOptionsInput
}

const auth = (options: ProviderAuthOption<"optional">) => AuthOptions.bearer(options, "OPENAI_API_KEY")

const defaults = (input: Config) => {
  const { apiKey: _, auth: _auth, baseURL: _baseURL, queryParams: _queryParams, image: _image, ...rest } = input
  return rest
}

const configuredRoute = <Body, Prepared>(route: Route<Body, Prepared>, input: Config) =>
  route.with({
    auth: auth(input),
    endpoint: { baseURL: input.baseURL, query: input.queryParams },
  })

export const configure = (input: Config = {}) => {
  const responsesRoute = configuredRoute(OpenAIResponses.route, input)
  const responsesWebSocketRoute = configuredRoute(OpenAIResponses.webSocketRoute, input)
  const chatRoute = configuredRoute(OpenAIChat.route, input)
  const modelDefaults = defaults(input)
  const responses = (id: string | ModelID) =>
    responsesRoute.with(withOpenAIOptions(id, modelDefaults, { textVerbosity: true })).model({ id })
  const responsesWebSocket = (id: string | ModelID) =>
    responsesWebSocketRoute.with(withOpenAIOptions(id, modelDefaults, { textVerbosity: true })).model({ id })
  const chat = (id: string | ModelID) => chatRoute.with(withOpenAIOptions(id, modelDefaults)).model({ id })
  const image = (modelID: string | ModelID) =>
    OpenAIImages.model({
      id: modelID,
      auth: auth(input),
      baseURL: input.baseURL,
      headers: input.headers,
      defaults: {
        providerOptions:
          input.image?.providerOptions === undefined ? undefined : { openai: { ...input.image.providerOptions } },
        http: mergeHttpOptions(
          input.http === undefined ? undefined : HttpOptions.make(input.http),
          input.queryParams === undefined ? undefined : new HttpOptions({ query: input.queryParams }),
        ),
      },
    })

  return {
    id,
    model: responses,
    responses,
    responsesWebSocket,
    chat,
    image,
    configure,
  }
}

export const provider = configure()

const config = (settings: Settings): Config => {
  const headers = {
    ...(settings.organization === undefined ? {} : { "OpenAI-Organization": settings.organization }),
    ...(settings.project === undefined ? {} : { "OpenAI-Project": settings.project }),
    ...settings.headers,
  }
  return {
    apiKey: settings.apiKey,
    baseURL: settings.baseURL,
    headers: Object.keys(headers).length === 0 ? undefined : headers,
    http: settings.body === undefined ? undefined : { body: { ...settings.body } },
    limits: settings.limits,
    providerOptions: settings.providerOptions,
    queryParams: settings.queryParams === undefined ? undefined : { ...settings.queryParams },
  }
}

export const model: ProviderPackage.Definition<Settings>["model"] = (modelID, settings) => {
  const configured = configure(config(settings))
  if (settings.transport === undefined || settings.transport === "http") return configured.responses(modelID)
  if (settings.transport === "websocket") return configured.responsesWebSocket(modelID)
  throw new Error(`Unsupported OpenAI Responses transport: ${String(settings.transport)}`)
}

export const chatModel: ProviderPackage.Definition<Settings>["model"] = (modelID, settings) =>
  configure(config(settings)).chat(modelID)
export const responses = provider.responses
export const responsesWebSocket = provider.responsesWebSocket
export const chat = provider.chat
export const image = provider.image
