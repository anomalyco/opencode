import { expect } from "bun:test"
import { Effect } from "effect"
import { LLM, LLMRequest, Message } from "../../src/index.js"
import { LLMClient } from "../../src/route/client.js"
import { OpenAI, XAI, Anthropic } from "../../src/providers.js"
import { recordedTests } from "../recorded-test.js"

const history = [
  Message.user("Remember the project codename COPPER-ORBIT-42."),
  Message.assistant(
    "The project codename is COPPER-ORBIT-42. " + "We reviewed the implementation and tests. ".repeat(1000),
  ),
]

for (const provider of [
  {
    id: "openai",
    key: "OPENAI_API_KEY",
    model: OpenAI.configure({ apiKey: process.env.OPENAI_API_KEY ?? "fixture" }).responses("gpt-5.3-codex"),
  },
  {
    id: "xai",
    key: "XAI_API_KEY",
    model: XAI.configure({ apiKey: process.env.XAI_API_KEY ?? "fixture" }).responses("grok-4.6"),
  },
]) {
  recordedTests({ prefix: `${provider.id}-compaction`, provider: provider.id, requires: [provider.key] }).effect(
    "compacts and continues with the provider checkpoint",
    () =>
      Effect.gen(function* () {
        const request = LLM.request({ model: provider.model, messages: history, generation: { maxTokens: 1024 } })
        const compacted = yield* LLMClient.compact(request)
        const result = yield* LLMClient.generate(
          LLMRequest.update(request, {
            messages: [
              ...compacted.replacement,
              Message.user("What is the project codename? Reply only with the codename."),
            ],
          }),
        )
        expect(result.text).toContain("COPPER-ORBIT-42")
      }),
    120000,
  )
}

recordedTests({
  prefix: "anthropic-compaction",
  provider: "anthropic",
  requires: ["ANTHROPIC_API_KEY"],
  options: { redact: { allowRequestHeaders: ["anthropic-version", "anthropic-beta"] } },
}).effect(
  "automatically compacts and continues after a pause",
  () =>
    Effect.gen(function* () {
      const model = Anthropic.configure({ apiKey: process.env.ANTHROPIC_API_KEY ?? "fixture" }).model(
        "claude-sonnet-4-6",
      )
      const request = LLM.request({
        model,
        messages: [
          Message.user(
            "Remember the project codename COPPER-ORBIT-42. " +
              "The implementation and tests were reviewed. ".repeat(10000),
          ),
        ],
        generation: { maxTokens: 4096 },
        providerOptions: {
          contextManagement: {
            edits: [
              { type: "compact_20260112", trigger: { type: "input_tokens", value: 50000 }, pauseAfterCompaction: true },
            ],
          },
        },
      })
      const first = yield* LLMClient.generate(request)
      expect(first.finishReason.raw).toBe("compaction")
      expect(first.message.content.some((part) => part.type === "compaction")).toBe(true)
      const result = yield* LLMClient.generate(
        LLMRequest.update(request, {
          messages: [
            ...request.messages,
            first.message,
            Message.user("What is the project codename? Reply only with the codename."),
          ],
        }),
      )
      expect(result.text).toContain("COPPER-ORBIT-42")
    }),
  120000,
)
