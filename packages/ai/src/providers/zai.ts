import type { ProviderPackage } from "../provider-package.js"
import { ZAIChat } from "../protocols/zai-chat.js"
import { ZAIImages } from "../protocols/zai-images.js"
import { OpenAIChat } from "../protocols/openai-chat.js"
import { AuthOptions, type ProviderAuthOption } from "../route/auth-options.js"
import { Route, type RouteDefaultsInput } from "../route/client.js"
import { Endpoint } from "../route/endpoint.js"
import { MediaRoute } from "../route/media.js"
import { ProviderID, type ModelID, type ProviderOptions } from "../schema/index.js"
import { config } from "./zai-settings.js"

const id = ProviderID.make("zai")

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

const auth = (options: ProviderAuthOption<"optional">) => AuthOptions.bearer(options, "ZAI_API_KEY")

const chatRoute = Route.make({
  id: "zai-chat",
  provider: id,
  providerMetadataKey: "zai",
  protocol: ZAIChat.protocol,
  endpoint: Endpoint.path("/chat/completions", { baseURL: "https://api.z.ai/api/paas/v4" }),
  framing: OpenAIChat.framing,
})

export const routes = [chatRoute]

const configure = (input: Config = {}) => {
  const { apiKey: _apiKey, auth: _auth, baseURL, ...rest } = input
  const chat = (modelID: string | ModelID) =>
    chatRoute
      .with({
        ...rest,
        endpoint: baseURL === undefined ? undefined : { baseURL },
        auth: auth(input),
      })
      .model<ChatOptionsInput>({ id: modelID, compatibility: ZAIChat.compatibility })
  const media = MediaRoute.deployment(input, auth(input))
  const image = (modelID: string | ModelID, providerOptions?: ProviderOptions) =>
    ZAIImages.model({ ...media, id: modelID, providerOptions })

  return Object.assign(chat, { id, chat, image, configure })
}

export const zai = configure()

export const model: ProviderPackage.Model<Settings, ChatOptionsInput> = (modelID, settings) =>
  configure(config(settings))(modelID)
