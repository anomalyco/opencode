import { Effect } from "effect"
import {
  CompactionCheckpointResponse,
  CompactionResponse,
  LanguageModel,
  LLM,
  LLMClient,
  LLMRequest,
} from "../../src/index.js"
import {
  Anthropic,
  Azure,
  AmazonBedrock,
  AmazonBedrockMantle,
  OpenAI,
  OpenAICompatibleResponses,
  XAI,
} from "../../src/providers.js"
import type { WebSocketChannelExecutor } from "../../src/route.js"
import type { RoutePatch } from "../../src/route/client.js"
import type { OpenAIResponsesBody } from "../../src/protocols/openai-responses.js"
import type { Prepared } from "../../src/protocols/open-responses-channel.js"

declare const webSocket: WebSocketChannelExecutor
const model = OpenAI.configure().responses("fixture")
const request = LLM.request({ model, prompt: "hello" })
LLMClient.compact(request).pipe(Effect.map((result) => result satisfies CompactionResponse))
LLMClient.compact(request, { mechanism: "endpoint" }).pipe(Effect.map((result) => result satisfies CompactionResponse))
LLMClient.compact(request, { mechanism: "trigger", webSocket }).pipe(
  Effect.map((result) => {
    result satisfies CompactionCheckpointResponse
    result.checkpoint.encrypted satisfies string
    result.responseID satisfies string
    // @ts-expect-error A trigger does not return replacement history.
    result.replacement
  }),
)
// @ts-expect-error Endpoint compaction does not accept a WebSocket executor.
LLMClient.compact(request, { mechanism: "endpoint", webSocket })
// @ts-expect-error Omitting mechanism selects the HTTP endpoint.
LLMClient.compact(request, { webSocket })
// @ts-expect-error Unknown mechanisms do not have a permissive fallback overload.
LLMClient.compact(request, { mechanism: "other" })

for (const selected of [
  model,
  OpenAI.model("fixture", {}),
  model.route.with({ headers: { fixture: "test" } }).model({ id: "fixture" }),
  LanguageModel.make(LanguageModel.input(model)),
  LanguageModel.update(model, { defaults: { generation: { maxTokens: 100 } } }),
]) {
  LLMClient.compact(LLM.request({ model: selected }), { mechanism: "trigger" })
}
LLMClient.compact(new LLMRequest(LLMRequest.input(request)), { mechanism: "trigger" })
LLMClient.compact(LLMRequest.update(request, { messages: [] }), { mechanism: "trigger" })

const azure = Azure.configure({ resourceName: "fixture" }).responses("fixture")
const xai = XAI.configure().responses("fixture")
LLMClient.compact(LLM.request({ model: azure }))
LLMClient.compact(LLM.request({ model: xai }))
// @ts-expect-error Azure must not inherit OpenAI's trigger operation.
LLMClient.compact(LLM.request({ model: azure }), { mechanism: "trigger" })
LLMClient.compact(LLM.request({ model: Azure.responsesModel("fixture", { resourceName: "fixture" }) }), {
  // @ts-expect-error Azure's package entrypoint must preserve its narrower capability.
  mechanism: "trigger",
})
// @ts-expect-error xAI endpoint support does not imply trigger support.
LLMClient.compact(LLM.request({ model: xai }), { mechanism: "trigger" })
// @ts-expect-error xAI's package entrypoint must preserve its narrower capability.
LLMClient.compact(LLM.request({ model: XAI.model("fixture", {}) }), { mechanism: "trigger" })

const unsupported = {
  bedrock: LLM.request({ model: AmazonBedrock.configure().model("fixture") }),
  mantle: LLM.request({ model: AmazonBedrockMantle.configure().responses("fixture") }),
  anthropic: LLM.request({ model: Anthropic.configure().model("fixture") }),
  openai: LLM.request({ model: OpenAI.configure().chat("fixture") }),
  azure: LLM.request({ model: Azure.configure({ resourceName: "fixture" }).chat("fixture") }),
  xai: LLM.request({ model: XAI.configure().chat("fixture") }),
  compatible: LLM.request({
    model: OpenAICompatibleResponses.configure({ baseURL: "https://example.com" }).model("fixture"),
  }),
}
// @ts-expect-error Bedrock does not expose endpoint compaction.
LLMClient.compact(unsupported.bedrock)
// @ts-expect-error Bedrock does not expose trigger compaction.
LLMClient.compact(unsupported.bedrock, { mechanism: "trigger" })
// @ts-expect-error Mantle does not expose endpoint compaction.
LLMClient.compact(unsupported.mantle)
// @ts-expect-error Mantle must not inherit trigger support from OpenAI's protocol.
LLMClient.compact(unsupported.mantle, { mechanism: "trigger" })
// @ts-expect-error Anthropic does not expose endpoint compaction.
LLMClient.compact(unsupported.anthropic)
// @ts-expect-error Anthropic does not expose trigger compaction.
LLMClient.compact(unsupported.anthropic, { mechanism: "trigger" })
// @ts-expect-error OpenAI Chat does not expose endpoint compaction.
LLMClient.compact(unsupported.openai)
// @ts-expect-error OpenAI Chat does not expose trigger compaction.
LLMClient.compact(unsupported.openai, { mechanism: "trigger" })
// @ts-expect-error Azure Chat does not expose endpoint compaction.
LLMClient.compact(unsupported.azure)
// @ts-expect-error Azure Chat does not expose trigger compaction.
LLMClient.compact(unsupported.azure, { mechanism: "trigger" })
// @ts-expect-error xAI Chat does not expose endpoint compaction.
LLMClient.compact(unsupported.xai)
// @ts-expect-error xAI Chat does not expose trigger compaction.
LLMClient.compact(unsupported.xai, { mechanism: "trigger" })
// @ts-expect-error Generic protocol compatibility does not grant endpoint support.
LLMClient.compact(unsupported.compatible)
// @ts-expect-error Generic protocol compatibility does not grant trigger support.
LLMClient.compact(unsupported.compatible, { mechanism: "trigger" })
// @ts-expect-error Changing the model replaces its capability.
LLMClient.compact(LLMRequest.update(request, { model: azure }), { mechanism: "trigger" })
// @ts-expect-error Changing the route replaces its capability.
LLMClient.compact(LLM.request({ model: LanguageModel.update(model, { route: azure.route }) }), { mechanism: "trigger" })
LLMClient.compact(
  LLM.request({
    model: model.route.with({ compact: { endpoint: model.route.compact.endpoint } }).model({ id: "fixture" }),
  }),
  // @ts-expect-error Replacing route operations does not retain the old trigger capability.
  { mechanism: "trigger" },
)

declare const dynamic: LLMRequest
declare const patch: Partial<LLMRequest.Input>
declare const routePatch: RoutePatch<OpenAIResponsesBody, Prepared>
// @ts-expect-error A dynamic operation override cannot preserve trigger support.
LLMClient.compact(LLM.request({ model: model.route.with(routePatch).model({ id: "fixture" }) }), {
  mechanism: "trigger",
})
// @ts-expect-error Explicitly removing operations removes trigger support.
LLMClient.compact(LLM.request({ model: model.route.with({ compact: undefined }).model({ id: "fixture" }) }), {
  mechanism: "trigger",
})
// @ts-expect-error Dynamic models must be narrowed.
LLMClient.compact(dynamic, { mechanism: "trigger" })
if (LLMClient.canCompact(dynamic, { mechanism: "trigger" })) {
  LLMClient.compact(dynamic, { mechanism: "trigger" })
  LLMClient.Service.use((client) => client.compact(dynamic, { mechanism: "trigger" }))
}
if (LLMClient.canCompact(dynamic)) {
  LLMClient.compact(dynamic)
  // @ts-expect-error Endpoint narrowing does not grant trigger support.
  LLMClient.compact(dynamic, { mechanism: "trigger" })
}
// @ts-expect-error A dynamic model override cannot preserve trigger support.
LLMClient.compact(LLMRequest.update(request, patch), { mechanism: "trigger" })
