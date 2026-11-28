import { OpenAIChat } from "../../../protocols/openai-chat.js"
import { Provider } from "../../../provider.js"
import { openAIDefaultOptions, type OpenAIProviderOptionsInput } from "../../openai-options.js"
import { baseURL, region, settings, shared, type Settings } from "./shared.js"

export type { Settings } from "./shared.js"

export const chatCompletions = OpenAIChat.api.configure({
  baseURL: baseURL(region),
  metadataKey: "mantle",
  options: (modelID) => ({ providerOptions: openAIDefaultOptions(modelID) }),
})

export const model = Provider.entrypoint<Settings, OpenAIProviderOptionsInput>(
  Provider.make({ ...shared, settings: settings(), apis: [chatCompletions] }),
)
