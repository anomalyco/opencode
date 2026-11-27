import { OpenResponses } from "../../protocols/open-responses.js"
import { Provider } from "../../provider.js"
import { shared, type ResponsesOptionsInput, type Settings as SharedSettings } from "./shared.js"

export type Settings = SharedSettings<ResponsesOptionsInput>

export const responses = OpenResponses.api.extend({ id: "zai-coding-responses" }).configure({ baseURL: "https://api.z.ai/api/v1", metadataKey: "zai" })

export const model = Provider.entrypoint<Settings, ResponsesOptionsInput>(
  Provider.make({ ...shared, apis: [responses] }),
)
