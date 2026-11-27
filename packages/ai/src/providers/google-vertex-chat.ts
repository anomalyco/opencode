import type { ProviderPackage } from "../provider-package.js"
import { OpenAIChat } from "../protocols/openai-chat.js"
import { Provider } from "../provider.js"
import { GoogleVertexShared } from "./google-vertex-shared.js"
import type { OpenAIProviderOptionsInput } from "./openai-options.js"

export type Settings = ProviderPackage.Settings &
  OpenAIProviderOptionsInput & {
    readonly accessToken?: string
    readonly apiKey?: never
    readonly baseURL?: string
    readonly location?: string
    readonly project?: string
  }

export const googleVertexChat = Provider.make({
  ...GoogleVertexShared.shared,
  apis: [OpenAIChat.api.configure({ id: "google-vertex-chat", metadataKey: "vertex" })],
  settings: GoogleVertexShared.oauthSettings(
    "Chat",
    (project, location) =>
      `https://aiplatform.googleapis.com/v1/projects/${project}/locations/${location}/endpoints/openapi`,
  ),
})

export const model = Provider.entrypoint<Settings, OpenAIProviderOptionsInput>(googleVertexChat)
