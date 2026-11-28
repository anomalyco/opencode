import { Struct } from "effect"
import type { AlibabaChat } from "../protocols/alibaba-chat.js"
import { AlibabaImages } from "../protocols/alibaba-images.js"
import { OpenAIEmbeddings } from "../protocols/openai-embeddings.js"
import { Provider } from "../provider.js"
import { AuthOptions, type ProviderAuthOption } from "../route/auth-options.js"
import { MediaRoute } from "../route/media.js"
import {
  mergeTransport,
  ToolDefinition,
  type ModelID,
  type ProviderOptions,
  type RequestOptions,
} from "../schema/index.js"
import { chatCompletions, type Settings as ChatSettings } from "./alibaba/chat.js"
import { messages } from "./alibaba/messages.js"
import { responses } from "./alibaba/responses.js"
import { auth, baseURL, env, id, paths, type Location, type Settings as LocatedSettings } from "./alibaba/shared.js"

export type { Location, Region } from "./alibaba/shared.js"
export type { OptionsInput as ChatOptionsInput } from "../protocols/alibaba-chat.js"
export type { OptionsInput as MessagesOptionsInput } from "../protocols/alibaba-messages.js"
export type { OptionsInput as ResponsesOptionsInput } from "../protocols/alibaba-responses.js"
export type { AlibabaImageOptions } from "../protocols/alibaba-images.js"
export { model } from "./alibaba/chat.js"
export { model as messagesModel } from "./alibaba/messages.js"
export { model as responsesModel } from "./alibaba/responses.js"

export type Settings<Options = AlibabaChat.OptionsInput> = LocatedSettings<Options>

/** Alibaba Model Studio in one region. Each API is served from its own path on the region's host. */
export const alibaba = (location: Location) =>
  Provider.make({
    id,
    auth,
    apis: [
      chatCompletions.configure({ baseURL: baseURL(location, paths.compatible) }),
      messages.configure({ baseURL: baseURL(location, paths.anthropic) }),
      responses.configure({ baseURL: baseURL(location, paths.compatible) }),
    ],
  })

/** Connection settings for Alibaba's image and embedding models. Language models come from `alibaba`. */
export type Config = Location &
  Omit<RequestOptions, "providerOptions"> &
  ProviderAuthOption<"optional"> & {
    readonly providerOptions?: ProviderOptions
  }

export const media = (input: Config) => {
  const credential = AuthOptions.bearer(input, env)
  const deployment = MediaRoute.deployment({ ...input, baseURL: baseURL(input, paths.media) }, credential)
  const embeddingRoute = OpenAIEmbeddings.route.with({
    provider: id,
    endpoint: { baseURL: baseURL(input, paths.compatible) },
    auth: credential,
    ...mergeTransport(input),
  })
  return {
    image: (modelID: string | ModelID, providerOptions?: ProviderOptions) =>
      AlibabaImages.model({ ...deployment, id: modelID, providerOptions }),
    embedding: (modelID: string | ModelID, providerOptions?: ProviderOptions) =>
      embeddingRoute.model({ id: modelID, providerOptions }),
  }
}

export const imageModel = (modelID: string, settings: ChatSettings) => {
  const input = config(settings)
  return media(input).image(modelID, input.providerOptions)
}
export const embeddingModel = (modelID: string, settings: ChatSettings) => {
  const input = config(settings)
  return media(input).embedding(modelID, input.providerOptions)
}

function config(input: ChatSettings) {
  const { body, ...rest } = input
  return {
    ...rest,
    http: body === undefined ? undefined : { body },
    providerOptions: Struct.omit(rest, ["apiKey", "baseURL", "headers", "region", "workspaceID"]),
  }
}

export const webSearch = () => hostedTool("web_search", "Search the web with Alibaba's hosted search tool.")
export const webExtractor = () => hostedTool("web_extractor", "Extract web page content with Alibaba's hosted tool.")
export const codeInterpreter = () => hostedTool("code_interpreter", "Execute code with Alibaba's hosted interpreter.")

function hostedTool(type: "web_search" | "web_extractor" | "code_interpreter", description: string) {
  return ToolDefinition.make({
    name: type,
    description,
    inputSchema: { type: "object", properties: {} },
    native: { alibaba: { type } },
  })
}

export * as Alibaba from "./alibaba.js"
