import { OpenResponses } from "../../protocols/open-responses.js"
import { Provider } from "../../provider.js"
import { shared, type ResponsesOptionsInput, type Settings as SharedSettings } from "./shared.js"

export type Settings = SharedSettings<ResponsesOptionsInput>

export const responses = OpenResponses.api.extend({ id: "moonshot-responses" }).configure({
  baseURL: "https://api.moonshot.ai/v1",
  metadataKey: "moonshot",
  capabilities: { tools: { sanitizer: "moonshot" } },
})

export const model = Provider.entrypoint<Settings, ResponsesOptionsInput>(
  Provider.make({ ...shared, apis: [responses] }),
)
