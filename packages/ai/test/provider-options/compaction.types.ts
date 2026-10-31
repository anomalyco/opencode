import { Effect } from "effect"
import {
  ai,
  CompactionPart,
  LanguageModel,
  LLMClient,
  LLMEvent,
  LLMRequest,
  Message,
  ProviderID,
} from "../../src/effect.js"
import { OpenAI, Azure, XAI, Anthropic, OpenAICompatibleResponses } from "../../src/providers.js"

const openai = OpenAI.configure({
  apiKey: "test",
  providerOptions: { contextManagement: [{ type: "compaction", compactThreshold: 100000 }] },
}).responses("gpt-5.3-codex")
ai.compact(ai.request({ model: openai, prompt: "hello" }))

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
  ai.compact(ai.request({ model, prompt: "hello" }))
}

const unsupported = {
  anthropic: ai.request({ model: Anthropic.configure().model("fixture") }),
  openaiChat: ai.request({ model: OpenAI.configure().chat("fixture") }),
  azureChat: ai.request({ model: Azure.configure({ resourceName: "test" }).chat("fixture") }),
  xaiChat: ai.request({ model: XAI.configure().chat("fixture") }),
  compatible: ai.request({
    model: OpenAICompatibleResponses.configure({ baseURL: "https://example.com" }).model("fixture"),
  }),
}
// @ts-expect-error Anthropic has no standalone compact endpoint.
ai.compact(unsupported.anthropic)
// @ts-expect-error Chat does not expose Responses compaction.
ai.compact(unsupported.openaiChat)
// @ts-expect-error Azure Chat does not expose Responses compaction.
ai.compact(unsupported.azureChat)
// @ts-expect-error xAI Chat does not expose Responses compaction.
ai.compact(unsupported.xaiChat)
// @ts-expect-error Protocol compatibility does not guarantee endpoint support.
ai.compact(unsupported.compatible)
LLMClient.Service.use((client) => {
  // @ts-expect-error The service enforces the same capability as the convenience function.
  return client.compact(unsupported.anthropic)
})

const request = ai.request({ model: openai, prompt: "hello" })
ai.compact(LLMRequest.update(request, { messages: [Message.user("continue")] }))
ai.compact(new LLMRequest(LLMRequest.input(request)))
const switched = LLMRequest.update(request, { model: Anthropic.configure().model("fixture") })
// @ts-expect-error Switching models replaces, rather than inherits, the capability.
ai.compact(switched)
ai.compact(LLMRequest.update(switched, { model: openai }))
ai.compact(
  // @ts-expect-error Replacing the route also replaces compaction capability.
  ai.request({ model: LanguageModel.update(openai, { route: Anthropic.configure().model("fixture").route }) }),
)

declare const dynamicModel: LanguageModel
declare const dynamicPatch: Partial<LLMRequest.Input>
const dynamicRequest = ai.request({ model: dynamicModel, prompt: "hello" })
// @ts-expect-error A dynamically selected model must be narrowed first.
ai.compact(dynamicRequest)
if (ai.canCompact(dynamicRequest)) ai.compact(dynamicRequest)
// @ts-expect-error An optional model override cannot retain the old capability statically.
ai.compact(LLMRequest.update(request, dynamicPatch))

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
ai.compact(ai.request({ model: openai, prompt: "hello" })).pipe(
  Effect.map((result) => {
    result.replacement satisfies ReadonlyArray<Message>
    // @ts-expect-error The replacement window is named explicitly; the old field is not an alias.
    result.messages
    // @ts-expect-error Compaction returns replacement history, not a synthetic assistant message.
    result.message
  }),
)
ai.request({
  model: openai,
  providerOptions: {
    // @ts-expect-error A token threshold is numeric.
    contextManagement: [{ type: "compaction", compactThreshold: "100000" }],
  },
})
const anthropic = Anthropic.configure().model("claude-opus-4-6")
ai.request({
  model: anthropic,
  providerOptions: {
    contextManagement: {
      edits: [{ type: "compact_20260112", pauseAfterCompaction: true, instructions: "Summarize without using tools" }],
    },
  },
})
ai.request({
  model: anthropic,
  providerOptions: {
    // @ts-expect-error A pause setting is boolean.
    contextManagement: { edits: [{ type: "compact_20260112", pauseAfterCompaction: "yes" }] },
  },
})
