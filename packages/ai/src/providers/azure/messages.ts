import { AnthropicMessages } from "../../protocols/anthropic-messages.js"
import { Provider } from "../../provider.js"
import { Endpoint } from "../../route/endpoint.js"
import { authentication, entrypoint, id, type Connection, type MessagesSettings } from "./shared.js"

export type Settings = MessagesSettings

// Claude on Foundry serves Anthropic Messages under the resource's `services.ai.azure.com` host and accepts the
// resource key as `x-api-key`; it rejects `api-key`.
export const azureMessages = Provider.make({
  id,
  auth: authentication("x-api-key"),
  apis: [AnthropicMessages.api.configure({ capabilities: { cache: { markers: false } } })],
})

export const model = entrypoint<AnthropicMessages.ProviderOptionsInput>(
  azureMessages,
  (input: Connection) => ({
    baseURL: Endpoint.trimBaseUrl(
      input.baseURL ?? `https://${input.resourceName!.trim()}.services.ai.azure.com/anthropic/v1`,
    ),
    query: input.queryParams,
  }),
  "x-api-key",
)
