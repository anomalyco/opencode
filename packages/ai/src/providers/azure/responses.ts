import { Api } from "../../api.js"
import { Capabilities } from "../../capabilities.js"
import { OpenAIResponses } from "../../protocols/openai-responses.js"
import { Provider } from "../../provider.js"
import type { OpenAIProviderOptionsInput } from "../openai-options.js"
import { options } from "../openai/shared.js"
import { authentication, endpoint, entrypoint, id } from "./shared.js"

export type { Settings } from "./shared.js"

const WEBSOCKET_ROTATE_AFTER_MS = 55 * 60 * 1000

/** OpenAI Responses on Azure. Azure serves the compaction endpoint but not compaction triggers. */
export const responses = Api.make({
  name: "responses",
  id: "azure-openai-responses",
  protocol: OpenAIResponses.protocol,
  path: OpenAIResponses.PATH,
  transport: OpenAIResponses.channelTransport({
    id: "azure-openai-responses",
    name: "Azure OpenAI Responses",
    rotateAfterMs: WEBSOCKET_ROTATE_AFTER_MS,
    enabled: (value) => {
      const url = new URL(value)
      return (
        url.protocol === "https:" &&
        url.hostname.endsWith(".openai.azure.com") &&
        url.pathname.endsWith("/openai/v1/responses") &&
        url.searchParams.get("api-version") === "v1"
      )
    },
    url: (value) => {
      const url = new URL(value)
      url.searchParams.delete("api-version")
      return url.toString()
    },
  }),
  options: OpenAIResponses.api.options,
  capabilities: Capabilities.defaults<Capabilities.Responses>({ compaction: { trigger: false } }),
  compact: OpenAIResponses.api.compact,
}).configure({ options })

export const model = entrypoint<OpenAIProviderOptionsInput, typeof responses.compact>(
  Provider.make({ id, auth: authentication(), apis: [responses] }),
  endpoint,
)
