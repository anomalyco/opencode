import { Effect } from "effect"
import {
  CompactionPart,
  LanguageModel,
  LLM,
  LLMClient,
  LLMEvent,
  LLMRequest,
  Message,
  ProviderID,
} from "../../src/index.js"
import { OpenAI, Azure, XAI, Anthropic, OpenAICompatibleResponses } from "../../src/providers.js"

const openai = OpenAI.configure({
  apiKey: "test",
  providerOptions: { contextManagement: [{ type: "compaction", compactThreshold: 100000 }] },
}).responses("gpt-5.3-codex")
LLMClient.compact(LLM.request({ model: openai, prompt: "hello" }))

for (const model of [
  OpenAI.configure().responses("fixture"),
  Azure.configure({ resourceName: "test" }).responses("fixture"),
  XAI.configure().responses("fixture"),
  OpenAI.model("fixture", {}),
  Azure.responsesModel("fixture", { resourceName: "test" }),
  XAI.model("fixture", {}),
  openai.route.with({ headers: { "x-test": "test" } }).model({ id: "fixture" }),
  LanguageModel.update(openai, { defaults: { generation: { maxTokens: 100 } } }),
  LanguageModel.make(LanguageModel.input(openai)),
]) {
  LLMClient.compact(LLM.request({ model, prompt: "hello" }))
}

const unsupported = {
  anthropic: LLM.request({ model: Anthropic.configure().model("fixture") }),
  openaiChat: LLM.request({ model: OpenAI.configure().chat("fixture") }),
  azureChat: LLM.request({ model: Azure.configure({ resourceName: "test" }).chat("fixture") }),
  xaiChat: LLM.request({ model: XAI.configure().chat("fixture") }),
  compatible: LLM.request({
    model: OpenAICompatibleResponses.configure({ baseURL: "https://example.com" }).model("fixture"),
  }),
}
// @ts-expect-error Anthropic has no standalone compact endpoint.
LLMClient.compact(unsupported.anthropic)
// @ts-expect-error Chat does not expose Responses compaction.
LLMClient.compact(unsupported.openaiChat)
// @ts-expect-error Azure Chat does not expose Responses compaction.
LLMClient.compact(unsupported.azureChat)
// @ts-expect-error xAI Chat does not expose Responses compaction.
LLMClient.compact(unsupported.xaiChat)
// @ts-expect-error Protocol compatibility does not guarantee endpoint support.
LLMClient.compact(unsupported.compatible)
LLMClient.Service.use((client) => {
  // @ts-expect-error The service enforces the same capability as the convenience function.
  return client.compact(unsupported.anthropic)
})

const request = LLM.request({ model: openai, prompt: "hello" })
LLMClient.compact(LLMRequest.update(request, { messages: [Message.user("continue")] }))
LLMClient.compact(new LLMRequest(LLMRequest.input(request)))
const switched = LLMRequest.update(request, { model: Anthropic.configure().model("fixture") })
// @ts-expect-error Switching models replaces, rather than inherits, the capability.
LLMClient.compact(switched)
LLMClient.compact(LLMRequest.update(switched, { model: openai }))
LLMClient.compact(
  // @ts-expect-error Replacing the route also replaces compaction capability.
  LLM.request({ model: LanguageModel.update(openai, { route: Anthropic.configure().model("fixture").route }) }),
)

declare const dynamicModel: LanguageModel
declare const dynamicPatch: Partial<LLMRequest.Input>
const dynamicRequest = LLM.request({ model: dynamicModel, prompt: "hello" })
// @ts-expect-error A dynamically selected model must be narrowed first.
LLMClient.compact(dynamicRequest)
if (LLMClient.canCompact(dynamicRequest)) LLMClient.compact(dynamicRequest)
// @ts-expect-error An optional model override cannot retain the old capability statically.
LLMClient.compact(LLMRequest.update(request, dynamicPatch))

const checkpoint = CompactionPart.make({ provider: ProviderID.make("openai"), id: "cmp_1", encrypted: "opaque" })
const provider = ProviderID.make("anthropic")
CompactionPart.make({ provider, text: "summary" })
CompactionPart.make({ provider, text: null })
// @ts-expect-error A checkpoint must have a representation.
CompactionPart.make({ provider })
// @ts-expect-error Encrypted and summary representations are mutually exclusive.
CompactionPart.make({ provider, encrypted: "opaque", text: "summary" })
// @ts-expect-error A failed summary cannot also carry encrypted content.
LLMEvent.compaction({ provider, encrypted: "opaque", text: null })
// @ts-expect-error The canonical message type also enforces the invariant.
Message.assistant({ type: "compaction", provider })
if (checkpoint.encrypted !== undefined) {
  checkpoint.encrypted satisfies string
  checkpoint.text satisfies undefined
}
if (checkpoint.text !== undefined) {
  checkpoint.text satisfies string | null
  checkpoint.encrypted satisfies undefined
}
checkpoint.encrypted
// @ts-expect-error Compaction parts do not contain a generic provider payload.
checkpoint.value
LLMClient.compact(LLM.request({ model: openai, prompt: "hello" })).pipe(
  Effect.map((result) => {
    result.replacement satisfies ReadonlyArray<Message>
    // @ts-expect-error The replacement window is named explicitly; the old field is not an alias.
    result.messages
    // @ts-expect-error Compaction returns replacement history, not a synthetic assistant message.
    result.message
  }),
)
LLM.request({
  model: openai,
  providerOptions: {
    // @ts-expect-error A token threshold is numeric.
    contextManagement: [{ type: "compaction", compactThreshold: "100000" }],
  },
})
const anthropic = Anthropic.configure().model("claude-opus-4-6")
LLM.request({
  model: anthropic,
  providerOptions: {
    contextManagement: {
      edits: [{ type: "compact_20260112", pauseAfterCompaction: true, instructions: "Summarize without using tools" }],
    },
  },
})
LLM.request({
  model: anthropic,
  providerOptions: {
    // @ts-expect-error A pause setting is boolean.
    contextManagement: { edits: [{ type: "compact_20260112", pauseAfterCompaction: "yes" }] },
  },
})
