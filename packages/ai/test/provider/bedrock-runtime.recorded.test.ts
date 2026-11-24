import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { ai, Message, ToolDefinition } from "../../src/effect.js"
import { AmazonBedrock } from "../../src/providers.js"
import { LLMClient } from "../../src/route/client.js"
import { recordedTests } from "../recorded-test.js"

// Record with `env -u CI RECORD=true AWS_PROFILE=<profile> bun run test test/provider/bedrock-runtime.recorded.test.ts`.
// Keep the region stable for replay, which signs locally and never needs AWS credentials.
const region = "us-west-2"
const runtime = () =>
  AmazonBedrock.configure({
    region,
    auth: "sigv4",
    ...(process.env.RECORD === "true"
      ? { profile: process.env.AWS_PROFILE }
      : { credentials: { region, accessKeyId: "fixture", secretAccessKey: "fixture" } }),
  })

const recorded = recordedTests({ prefix: "bedrock-runtime", provider: "amazon-bedrock", requires: ["AWS_PROFILE"] })

const kimi = "global.moonshotai.kimi-k3.1"
const gpt = "global.openai.gpt-5.4"
const claude = "global.anthropic.claude-sonnet-4-6"

const lookup = ToolDefinition.make({
  name: "lookup_code",
  description: "Look up the secret code. The code is only available through this tool.",
  inputSchema: { type: "object", properties: {}, additionalProperties: false },
})

const toolPrompt = "Call lookup_code to get the secret code. After receiving the result, reply with just the code."

describe("Bedrock Runtime recorded", () => {
  recorded.effect.with(
    "Chat streams reasoning and replays a tool call",
    { protocol: "openai-chat", tags: ["reasoning", "tool-loop"], metadata: { model: kimi } },
    () =>
      Effect.gen(function* () {
        const initial = ai.request({
          model: runtime().chat(kimi),
          prompt: toolPrompt,
          tools: [lookup],
          maxTokens: 2048,
        })
        const first = yield* LLMClient.generate(initial)
        expect(first.finishReason.normalized).toBe("tool-calls")
        expect(first.reasoning.length).toBeGreaterThan(0)
        expect(first.toolCalls).toMatchObject([{ name: lookup.name, input: {} }])

        const second = yield* LLMClient.generate({
          ...initial,
          messages: [
            ...initial.messages,
            first.message,
            ...first.toolCalls.map((call) =>
              Message.tool({ id: call.id, name: call.name, result: "ORCHID-42", resultType: "text" }),
            ),
          ],
        })
        expect(second.finishReason.normalized).toBe("stop")
        expect(second.text).toContain("ORCHID-42")
      }),
  )

  recorded.effect.with(
    "Responses streams text and usage",
    { protocol: "open-responses", metadata: { model: gpt } },
    () =>
      Effect.gen(function* () {
        const response = yield* LLMClient.generate(
          ai.request({
            model: runtime().responses(gpt),
            prompt: "Reply with exactly: hello",
            maxTokens: 512,
            providerOptions: { reasoningEffort: "low" },
          }),
        )

        expect(response.finishReason.normalized).toBe("stop")
        expect(response.text.trim().toLowerCase()).toBe("hello")
        expect(response.usage?.outputTokens).toBeGreaterThan(0)
      }),
  )

  recorded.effect.with(
    "Messages streams and replays signed thinking through a tool call",
    {
      protocol: "anthropic-messages",
      tags: ["reasoning", "tool-loop"],
      metadata: { model: claude },
      options: { redact: { allowRequestHeaders: ["anthropic-version", "anthropic-beta"] } },
    },
    () =>
      Effect.gen(function* () {
        const initial = ai.request({
          model: runtime().messages(claude),
          prompt: `First calculate 37 * 43. Then ${toolPrompt} Include both the product and the code in your reply.`,
          tools: [lookup],
          providerOptions: { thinking: { type: "adaptive", display: "summarized" }, effort: "medium" },
          maxTokens: 2048,
          cache: "none",
        })
        const first = yield* LLMClient.generate(initial)
        expect(first.finishReason.normalized).toBe("tool-calls")
        expect(first.toolCalls).toMatchObject([{ name: lookup.name }])
        expect(first.message.content).toContainEqual(
          expect.objectContaining({
            type: "reasoning",
            providerMetadata: { "bedrock-runtime": expect.objectContaining({ signature: expect.any(String) }) },
          }),
        )

        const second = yield* LLMClient.generate({
          ...initial,
          messages: [
            ...initial.messages,
            first.message,
            ...first.toolCalls.map((call) =>
              Message.tool({ id: call.id, name: call.name, result: "ORCHID-42", resultType: "text" }),
            ),
          ],
        })
        expect(second.finishReason.normalized).toBe("stop")
        expect(second.text).toContain("ORCHID-42")
      }),
  )
})
