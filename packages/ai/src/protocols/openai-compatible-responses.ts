import { Api } from "../api.js"
import { Capabilities } from "../capabilities.js"
import { OpenResponses } from "./open-responses.js"

/** Open Responses as servers other than OpenAI expose it at `/responses`. */
export const api = Api.make({
  name: "responses",
  id: "openai-compatible-responses",
  protocol: OpenResponses.protocol,
  path: OpenResponses.PATH,
  transport: OpenResponses.httpTransport,
  options: { providerOptions: { store: false, include: ["reasoning.encrypted_content"] } },
  capabilities: Capabilities.defaults<Capabilities.Responses>(),
})

export * as OpenAICompatibleResponses from "./openai-compatible-responses.js"
