import { OpenResponses } from "../../protocols/open-responses.js"
import { Provider } from "../../provider.js"
import { shared, type ResponsesOptionsInput, type Settings as SharedSettings } from "./shared.js"

export type Settings = SharedSettings<ResponsesOptionsInput>

export const responses = OpenResponses.api.extend({ id: "minimax-responses" }).configure({ baseURL: "https://api.minimax.io/v1" })

export const model = Provider.entrypoint<Settings, ResponsesOptionsInput>(
  Provider.make({ ...shared, apis: [responses] }),
)
