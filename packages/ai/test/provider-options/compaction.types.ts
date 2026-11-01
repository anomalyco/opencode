import { Effect } from "effect"
import {
  ai,
  CompactionPart,
  LanguageModel,
  LLMClient,
  LLMEvent,
  type LLMRequest,
  Message,
  ProviderID,
} from "../../src/effect.js"
import { openai, azure, xai, anthropic, openaiCompatibleResponses } from "../../src/providers.js"

const openaiPackage = await import("../../src/providers/openai.js")
const azureResponsesPackage = await import("../../src/providers/azure/responses.js")
const xaiPackage = await import("../../src/providers/xai.js")

const openaiModel = openai
  .configure({
    apiKey: "test",
    providerOptions: { contextManagement: [{ type: "compaction", compactThreshold: 100000 }] },
  })
  .responses("gpt-5.3-codex")
ai.compact(ai.request({ model: openaiModel, prompt: "hello" }))

for (const model of [
  openai.configure().responses("fixture"),
  azure.configure({ resourceName: "test" }).responses("fixture"),
  xai.configure().responses("fixture"),
  openaiPackage.model("fixture", {}),
  azureResponsesPackage.model("fixture", { resourceName: "test" }),
  xaiPackage.model("fixture", {}),
  openaiModel.route.with({ headers: { "x-test": "test" } }).model({ id: "fixture" }),
  LanguageModel.update(openaiModel, { defaults: { generation: { maxTokens: 100 } } }),
  LanguageModel.make(LanguageModel.input(openaiModel)),
]) {
  ai.compact(ai.request({ model, prompt: "hello" }))
}

const unsupported = {
  anthropic: ai.request({ model: anthropic.configure()("fixture"), prompt: "Hello" }),
  openaiChat: ai.request({ model: openai.configure().chat("fixture"), prompt: "Hello" }),
  azureChat: ai.request({ model: azure.configure({ resourceName: "test" }).chat("fixture"), prompt: "Hello" }),
  xaiChat: ai.request({ model: xai.configure().chat("fixture"), prompt: "Hello" }),
  compatible: ai.request({
    model: openaiCompatibleResponses.configure({ baseURL: "https://example.com" })("fixture"),
    prompt: "Hello",
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

const request = ai.request({ model: openaiModel, prompt: "hello" })
ai.compact({ ...request, messages: [Message.user("continue")] })
ai.compact({ ...request })
const switched = { ...request, model: anthropic.configure()("fixture") }
// @ts-expect-error Switching models replaces, rather than inherits, the capability.
ai.compact(switched)
ai.compact({ ...switched, model: openaiModel })
ai.compact(
  // @ts-expect-error Replacing the route also replaces compaction capability.
  ai.request({
    model: LanguageModel.update(openaiModel, { route: anthropic.configure()("fixture").route }),
    prompt: "Hello",
  }),
)

declare const dynamicModel: LanguageModel
declare const dynamicPatch: Partial<LLMRequest>
const dynamicRequest = ai.request({ model: dynamicModel, prompt: "hello" })
// @ts-expect-error A dynamically selected model must be narrowed first.
ai.compact(dynamicRequest)
if (ai.canCompact(dynamicRequest)) ai.compact(dynamicRequest)
// @ts-expect-error An optional model override cannot retain the old capability statically.
ai.compact({ ...request, ...dynamicPatch })

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
ai.compact(ai.request({ model: openaiModel, prompt: "hello" })).pipe(
  Effect.map((result) => {
    result.replacement satisfies ReadonlyArray<Message>
    // @ts-expect-error The replacement window is named explicitly; the old field is not an alias.
    result.messages
    // @ts-expect-error Compaction returns replacement history, not a synthetic assistant message.
    result.message
  }),
)
ai.request({
  model: openaiModel,
  prompt: "Hello",
  providerOptions: {
    // @ts-expect-error A token threshold is numeric.
    contextManagement: [{ type: "compaction", compactThreshold: "100000" }],
  },
})
const anthropicModel = anthropic.configure()("claude-opus-4-6")
ai.request({
  model: anthropicModel,
  prompt: "Hello",
  providerOptions: {
    contextManagement: {
      edits: [{ type: "compact_20260112", pauseAfterCompaction: true, instructions: "Summarize without using tools" }],
    },
  },
})
ai.request({
  model: anthropicModel,
  prompt: "Hello",
  providerOptions: {
    // @ts-expect-error A pause setting is boolean.
    contextManagement: { edits: [{ type: "compact_20260112", pauseAfterCompaction: "yes" }] },
  },
})

// Plain inputs compact without `ai.request(...)`, and a model alone can be narrowed.
ai.compact({ model: openai.configure().responses("fixture"), messages: [Message.user("continue")] })
if (ai.canCompact(dynamicModel)) ai.compact({ model: dynamicModel, prompt: "continue" })
// @ts-expect-error A dynamically selected model must be narrowed first.
ai.compact({ model: dynamicModel, prompt: "continue" })
