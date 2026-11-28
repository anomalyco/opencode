import { MetaImages } from "../protocols/meta-images.js"
import { AuthOptions, type ProviderAuthOption } from "../route/auth-options.js"
import { MediaRoute } from "../route/media.js"
import { ToolDefinition, type ModelID, type OpenString, type RequestOptions } from "../schema/index.js"
import { Provider } from "../provider.js"
import type { OpenResponsesProviderOptionsInput } from "./open-responses-options.js"
import { chatCompletions } from "./meta/chat.js"
import { messages, type OptionsInput as MessagesOptionsInput } from "./meta/messages.js"
import { responses } from "./meta/responses.js"
import { shared, type ProviderOptionsInput, type Settings } from "./meta/shared.js"
import { toConfig } from "./settings.js"

export type { OptionsInput as MessagesOptionsInput } from "./meta/messages.js"

export type { ProviderOptionsInput, Settings } from "./meta/shared.js"
export type ImageOptions = MetaImages.ImageOptions

export interface WebSearchOptions {
  readonly searchContextSize?: "low" | "medium" | "high" | (string & {})
  readonly userLocation?: {
    readonly city?: string
    readonly region?: string
    readonly country?: string
    readonly timezone?: string
  }
}

export const webSearch = (options: WebSearchOptions = {}) =>
  ToolDefinition.make({
    name: "web_search",
    description: "Search the web with Meta's hosted search tool.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    native: {
      meta: {
        type: "web_search",
        search_context_size: options.searchContextSize,
        user_location:
          options.userLocation === undefined ? undefined : { type: "approximate", ...options.userLocation },
      },
    },
  })

export interface ImageGenerationOptions {
  readonly size?: string
  readonly outputFormat?: OpenString<"webp" | "png" | "jpeg">
  readonly reasoningStrength?: OpenString<"low" | "high">
  readonly enableImageSearch?: boolean
  readonly enableWebSearch?: boolean
  readonly enableShell?: boolean
}

export const imageGeneration = (options: ImageGenerationOptions = {}) =>
  ToolDefinition.make({
    name: "image_generation",
    description: "Generate or edit an image with Muse Image.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    native: {
      meta: {
        type: "image_generation",
        size: options.size,
        output_format: options.outputFormat,
        reasoning_strength: options.reasoningStrength,
        enable_image_search: options.enableImageSearch,
        enable_web_search: options.enableWebSearch,
        enable_shell: options.enableShell,
      },
    },
  })

/** Connection settings for Meta's media models. Language models come from `meta`. */
export type Config = Omit<RequestOptions, "providerOptions"> &
  ProviderAuthOption<"optional"> & {
    readonly baseURL?: string
    readonly providerOptions?: ProviderOptionsInput
  }

export const meta = Provider.make({ ...shared, apis: [responses, chatCompletions, messages] })

export const model = Provider.entrypoint<Settings, OpenResponsesProviderOptionsInput>(meta)
export const chatModel = Provider.entrypoint<Settings, OpenResponsesProviderOptionsInput>(meta, "chat-completions")
export const messagesModel = Provider.entrypoint<Settings, MessagesOptionsInput>(meta, "messages")

export const media = (input: Config = {}) => {
  const deployment = MediaRoute.deployment(input, AuthOptions.bearer(input, "META_API_KEY"))
  return { image: (modelID: string | ModelID) => MetaImages.model({ ...deployment, id: modelID }) }
}

export const image = media().image

export const imageModel = (modelID: string, settings?: Settings) => media(toConfig(settings)).image(modelID)

export * as Meta from "./meta.js"
