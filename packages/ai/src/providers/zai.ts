import type { ProviderPackage } from "../provider-package.js"
import { ZAIChat } from "../protocols/zai-chat.js"
import { ZAIImages } from "../protocols/zai-images.js"
import { OpenAIChat } from "../protocols/openai-chat.js"
import type { ProviderAuthOption } from "../route/auth-options.js"
import { Route, type RouteDefaultsInput } from "../route/client.js"
import { Endpoint } from "../route/endpoint.js"
import { MediaRoute } from "../route/media.js"
import { ProviderID, type ModelID, type ProviderOptions } from "../schema/index.js"
import { bearerRouteDefaults, toConfig } from "./settings.js"

export const id = ProviderID.make("zai")

export type ChatOptionsInput = ZAIChat.OptionsInput

export type Config = Omit<RouteDefaultsInput, "providerOptions"> &
  ProviderAuthOption<"optional"> & {
    readonly baseURL?: string
    readonly providerOptions?: ChatOptionsInput
  }

export type Settings = ProviderPackage.Settings &
  ChatOptionsInput & {
    readonly apiKey?: string | false
    readonly baseURL?: string
  }

export type { ZAIImageOptions } from "../protocols/zai-images.js"

const chatRoute = Route.make({
  id: "zai-chat",
  provider: id,
  providerMetadataKey: "zai",
  protocol: ZAIChat.protocol,
  endpoint: Endpoint.path("/chat/completions", { baseURL: "https://api.z.ai/api/paas/v4" }),
  framing: OpenAIChat.framing,
})

export const routes = [chatRoute]

export const configure = (input: Config = {}) => {
  const defaults = bearerRouteDefaults(input, "ZAI_API_KEY")
  const chat = (modelID: string | ModelID) =>
    chatRoute.with(defaults).model<ChatOptionsInput>({ id: modelID, compatibility: ZAIChat.compatibility })
  const media = MediaRoute.deployment(input, defaults.auth)
  const image = (modelID: string | ModelID, providerOptions?: ProviderOptions) =>
    ZAIImages.model({ ...media, id: modelID, providerOptions })

  return {
    id,
    model: chat,
    chat,
    image,
    configure,
  }
}

export const provider = configure()
export const image = provider.image
export const chat = provider.chat

export const model: ProviderPackage.Model<Settings, ChatOptionsInput> = (modelID, settings) =>
  configure(toConfig(settings)).model(modelID)
export const imageModel = (modelID: string, settings?: Settings) => {
  const input = toConfig(settings)
  return configure(input).image(modelID, input.providerOptions)
}

export * as ZAI from "./zai.js"
