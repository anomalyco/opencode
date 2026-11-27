import { Capabilities } from "../../capabilities.js"
import { OpenResponses } from "../../protocols/open-responses.js"
import { Provider } from "../../provider.js"
import { Framing } from "../../route/framing.js"
import { api, shared, type ProviderOptionsInput, type Settings } from "./shared.js"

export type { Settings } from "./shared.js"

export const responses = api({
  name: "responses",
  id: "vercel-ai-gateway-responses",
  protocol: OpenResponses.protocol,
  kind: "responses",
  path: OpenResponses.PATH,
  framing: Framing.sse,
  options: { providerOptions: { store: false, include: ["reasoning.encrypted_content"] } },
  capabilities: Capabilities.defaults<Capabilities.Responses>(),
})

export const model = Provider.entrypoint<Settings, ProviderOptionsInput>(
  Provider.make({ ...shared, apis: [responses] }),
)
