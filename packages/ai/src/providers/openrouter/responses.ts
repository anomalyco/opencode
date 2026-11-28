import { Effect, Schema } from "effect"
import { Api } from "../../api.js"
import { Capabilities } from "../../capabilities.js"
import { OpenResponses } from "../../protocols/open-responses.js"
import { Provider } from "../../provider.js"
import { Protocol } from "../../route/protocol.js"
import { HttpTransport } from "../../route/transport/index.js"
import type { OpenRouter } from "../openrouter.js"
import { SharedOptions, sharedOptions, shared } from "./shared.js"

export type Settings = OpenRouter.Settings<OpenRouter.OpenRouterResponsesProviderOptionsInput>

const Body = Schema.Struct({
  ...OpenResponses.OpenResponsesBody.fields,
  ...SharedOptions.fields,
})

const decodeOptions = Schema.decodeUnknownSync(SharedOptions)

export const responses = Api.make({
  name: "responses",
  id: "openrouter-responses",
  protocol: Protocol.make({
    id: "openrouter-responses",
    body: {
      schema: Body,
      from: (request) =>
        OpenResponses.fromRequest(request).pipe(
          Effect.map((body) => ({ ...body, ...sharedOptions(decodeOptions(request.providerOptions ?? {})) })),
        ),
    },
    stream: OpenResponses.protocol.stream,
    supportsEffortUpdates: OpenResponses.protocol.supportsEffortUpdates,
  }),
  path: OpenResponses.PATH,
  transport: HttpTransport.sseJson.with<typeof Body.Type>(),
  options: { providerOptions: { store: false, include: ["reasoning.encrypted_content"] } },
  capabilities: Capabilities.defaults<Capabilities.Responses>(),
})

export const model = Provider.entrypoint<Settings, OpenRouter.OpenRouterResponsesProviderOptionsInput>(
  Provider.make({ ...shared, apis: [responses] }),
)
