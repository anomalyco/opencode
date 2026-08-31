import { Effect } from "effect"
import { CompactionPart, LLM, LLMClient, LLMEvent, Message, ProviderID } from "../../src/index.js"
import { OpenAI, Anthropic, AmazonBedrock } from "../../src/providers.js"

const openai = OpenAI.configure({
  apiKey: "test",
  providerOptions: { contextManagement: [{ type: "compaction", compactThreshold: 100000 }] },
}).responses("gpt-5.3-codex")
LLMClient.compact(LLM.request({ model: openai, prompt: "hello" }))

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
for (const model of [
  Anthropic.configure().model("claude-opus-4-6"),
  AmazonBedrock.configure().messages("anthropic.claude-opus-4-6-v1"),
]) {
  LLM.request({
    model,
    providerOptions: {
      contextManagement: {
        edits: [
          { type: "compact_20260112", pauseAfterCompaction: true, instructions: "Summarize without using tools" },
        ],
      },
    },
  })
  LLM.request({
    model,
    providerOptions: {
      // @ts-expect-error A pause setting is boolean.
      contextManagement: { edits: [{ type: "compact_20260112", pauseAfterCompaction: "yes" }] },
    },
  })
}
