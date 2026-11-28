import { Effect } from "effect"
import {
  ai,
  CompactionCheckpointResponse,
  CompactionResponse,
  LanguageModel,
  LLMClient,
  type LLMRequest,
} from "../../src/effect.js"
import {
  Anthropic,
  Azure,
  AmazonBedrock,
  AmazonBedrockMantle,
  OpenAI,
  OpenAICompatibleResponses,
  XAI,
} from "../../src/providers.js"
import { AI } from "../../src/index.js"
import { Api, type AnyApi } from "../../src/api.js"
import { Provider } from "../../src/provider.js"
import type { WebSocketChannelExecutor } from "../../src/route.js"
import { OpenAIResponses } from "../../src/protocols/openai-responses.js"

declare const webSocket: WebSocketChannelExecutor
const model = OpenAI.openai.model("fixture")
const request = ai.request({ model, prompt: "hello" })
ai.compact(request, { mechanism: "endpoint" }).pipe(Effect.map((result) => result satisfies CompactionResponse))
ai.compact(request, { mechanism: "trigger", webSocket }).pipe(
  Effect.map((result) => {
    result satisfies CompactionCheckpointResponse
    result.checkpoint.encrypted satisfies string
    result.responseID satisfies string
    // @ts-expect-error A trigger does not return replacement history.
    result.replacement
  }),
)
// @ts-expect-error Endpoint compaction does not accept a WebSocket executor.
ai.compact(request, { mechanism: "endpoint", webSocket })
// @ts-expect-error Omitting mechanism selects the HTTP endpoint.
ai.compact(request, { webSocket })
// @ts-expect-error Unknown mechanisms do not have a permissive fallback overload.
ai.compact(request, { mechanism: "other" })

for (const selected of [
  model,
  OpenAI.model("fixture", {}),
  OpenAI.openai.with({ headers: { fixture: "test" } }).model("fixture"),
  LanguageModel.make({ ...model }),
  LanguageModel.update(model, { options: { maxTokens: 100 } }),
]) {
  ai.compact(ai.request({ model: selected, prompt: "Hello" }), { mechanism: "trigger" })
}
ai.compact({ ...request }, { mechanism: "trigger" })
ai.compact({ ...request, messages: [] }, { mechanism: "trigger" })

const xai = XAI.model("fixture")
// @ts-expect-error xAI endpoint support does not imply trigger support.
ai.compact(ai.request({ model: xai, prompt: "Hello" }), { mechanism: "trigger" })
// @ts-expect-error xAI's package entrypoint must preserve its narrower capability.
ai.compact(ai.request({ model: XAI.model("fixture", {}), prompt: "Hello" }), { mechanism: "trigger" })

const unsupported = {
  bedrock: ai.request({ model: AmazonBedrock.model("fixture"), prompt: "Hello" }),
  mantle: ai.request({ model: AmazonBedrockMantle.model("fixture"), prompt: "Hello" }),
  anthropic: ai.request({ model: Anthropic.model("fixture"), prompt: "Hello" }),
  openai: ai.request({ model: OpenAI.openai.model("fixture", { api: "chat-completions" }), prompt: "Hello" }),
  azure: ai.request({ model: Azure.chatModel("fixture", { resourceName: "fixture" }), prompt: "Hello" }),
  xai: ai.request({ model: XAI.xai.model("fixture", { api: "chat-completions" }), prompt: "Hello" }),
  compatible: ai.request({
    model: OpenAICompatibleResponses.model("fixture", { baseURL: "https://example.com" }),
    prompt: "Hello",
  }),
}
// @ts-expect-error Bedrock does not expose trigger compaction.
ai.compact(unsupported.bedrock, { mechanism: "trigger" })
// @ts-expect-error Mantle must not inherit trigger support from OpenAI's protocol.
ai.compact(unsupported.mantle, { mechanism: "trigger" })
// @ts-expect-error Anthropic does not expose trigger compaction.
ai.compact(unsupported.anthropic, { mechanism: "trigger" })
// @ts-expect-error OpenAI Chat does not expose trigger compaction.
ai.compact(unsupported.openai, { mechanism: "trigger" })
// @ts-expect-error Azure Chat does not expose trigger compaction.
ai.compact(unsupported.azure, { mechanism: "trigger" })
// @ts-expect-error xAI Chat does not expose trigger compaction.
ai.compact(unsupported.xai, { mechanism: "trigger" })
// @ts-expect-error Generic protocol compatibility does not grant trigger support.
ai.compact(unsupported.compatible, { mechanism: "trigger" })
// @ts-expect-error Changing the model replaces its capability.
ai.compact({ ...request, model: xai }, { mechanism: "trigger" })
const hosted = <const A extends AnyApi>(api: A) =>
  Provider.make({ id: "fixture", baseURL: "https://example.com", auth: Provider.keyless, apis: [api] })
const endpointOnly = Api.make({
  name: "responses",
  protocol: OpenAIResponses.protocol,
  path: OpenAIResponses.PATH,
  transport: OpenAIResponses.httpTransport,
  compact: { endpoint: OpenAIResponses.api.compact.endpoint },
})
const withoutOperations = Api.make({
  name: "responses",
  protocol: OpenAIResponses.protocol,
  path: OpenAIResponses.PATH,
  transport: OpenAIResponses.httpTransport,
})
ai.compact(
  ai.request({ model: hosted(endpointOnly).model("fixture"), prompt: "Hello" }),
  // @ts-expect-error An API with only the endpoint operation does not grant trigger support.
  { mechanism: "trigger" },
)

declare const dynamic: LLMRequest
declare const patch: Partial<LLMRequest>
declare const dynamicApi: AnyApi
// @ts-expect-error A dynamic API cannot preserve trigger support.
ai.compact(ai.request({ model: hosted(dynamicApi).model("fixture"), prompt: "Hello" }), {
  mechanism: "trigger",
})
// @ts-expect-error An API without operations has no trigger support.
ai.compact(ai.request({ model: hosted(withoutOperations).model("fixture"), prompt: "Hello" }), {
  mechanism: "trigger",
})
// @ts-expect-error Dynamic models must be narrowed.
ai.compact(dynamic, { mechanism: "trigger" })
if (ai.canCompact(dynamic, { mechanism: "trigger" })) {
  ai.compact(dynamic, { mechanism: "trigger" })
  LLMClient.Service.use((client) => client.compact(dynamic, { mechanism: "trigger" }))
}
if (ai.canCompact(dynamic)) {
  ai.compact(dynamic)
  // @ts-expect-error Endpoint narrowing does not grant trigger support.
  ai.compact(dynamic, { mechanism: "trigger" })
}
// @ts-expect-error A dynamic model override cannot preserve trigger support.
ai.compact({ ...request, ...patch }, { mechanism: "trigger" })

void AI.ai.compact(request).then((result) => result satisfies CompactionResponse)
void AI.ai.compact(request, { mechanism: "trigger", webSocket, signal: AbortSignal.timeout(1) }).then((result) => {
  result satisfies CompactionCheckpointResponse
  // @ts-expect-error A trigger does not return replacement history.
  result.replacement
})
// @ts-expect-error Endpoint compaction does not accept a WebSocket executor.
void AI.ai.compact(request, { webSocket })
// @ts-expect-error OpenAI Chat does not expose explicit compaction.
void AI.ai.compact(unsupported.openai)
// @ts-expect-error Dynamic models must be narrowed.
void AI.ai.compact(dynamic)
if (ai.canCompact(dynamic, { mechanism: "trigger" })) void AI.ai.compact(dynamic, { mechanism: "trigger" })
