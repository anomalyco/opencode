import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { CacheHint, LLM, Message, ToolCallPart } from "../../src/index.js"
import { AmazonBedrock, AmazonBedrockMantle } from "../../src/providers.js"
import { compileRequest } from "../../src/route/client.js"
import { it } from "../lib/effect.js"

const bedrock = AmazonBedrock.configure({ apiKey: "fixture" })

describe("Bedrock Converse model-specific cache support", () => {
  for (const id of [
    "deepseek.r1-v1:0",
    "meta.llama3-3-70b-instruct-v1:0",
    "mistral.mistral-large-2402-v1:0",
    "qwen.qwen3-coder-480b-a35b-v1:0",
    "openai.gpt-oss-120b-1:0",
    "cohere.command-r-v1:0",
    "anthropic.claude-v2:1",
    "anthropic.claude-3-haiku-20240307-v1:0",
    "anthropic.claude-3-5-sonnet-20240620-v1:0",
    "amazon.nova-unknown-v1:0",
    "custom-model",
    "arn:aws:bedrock:us-east-1:123456789012:application-inference-profile/abc123",
  ]) {
    for (const policy of [undefined, "auto", "none", { tools: true, system: true, messages: { tail: 3 } }] as const) {
      it.effect(`omits unsupported checkpoints for ${id} (${JSON.stringify(policy)})`, () =>
        Effect.gen(function* () {
          // Exercise both automatic placement and manual hints at every lowering site.
          const cache = policy === "none" ? new CacheHint({ type: "ephemeral", ttlSeconds: 3600 }) : undefined
          const prepared = yield* compileRequest(
            LLM.request({
              model: bedrock.model(id),
              cache: policy,
              system: [{ type: "text", text: "System prefix", cache }],
              tools: [{ name: "lookup", description: "Lookup", inputSchema: { type: "object" }, cache }],
              messages: [
                Message.user([{ type: "text", text: "Question", cache }]),
                Message.system([{ type: "text", text: "Update", cache }]),
                Message.assistant([
                  { type: "text", text: "Answer", cache },
                  { type: "reasoning", text: "Unsigned reasoning", cache },
                  ToolCallPart.make({ id: "call_1", name: "lookup", input: {} }),
                ]),
                Message.tool({ id: "call_1", name: "lookup", result: "Result", cache }),
              ],
            }),
          )

          expect(JSON.stringify(prepared.body)).not.toContain("cachePoint")
          expect(prepared.body).toMatchObject({
            modelId: id,
            system: [{ text: "System prefix" }],
            toolConfig: { tools: [{ toolSpec: { name: "lookup" } }] },
            messages: [
              { role: "user", content: [{ text: "Question" }, { text: "<system-update>\nUpdate\n</system-update>" }] },
              {
                role: "assistant",
                content: [{ text: "Answer" }, { text: "Unsigned reasoning" }, { toolUse: { name: "lookup" } }],
              },
              { role: "user", content: [{ toolResult: { content: [{ json: "Result" }] } }] },
            ],
          })
        }),
      )
    }
  }

  for (const [id, ttl] of [
    ["anthropic.claude-3-5-sonnet-20241022-v2:0", undefined],
    ["us.anthropic.claude-3-5-haiku-20241022-v1:0", undefined],
    ["eu.anthropic.claude-3-7-sonnet-20250219-v1:0", undefined],
    ["apac.anthropic.claude-sonnet-4-20250514-v1:0", undefined],
    ["anthropic.claude-opus-4-1-20250805-v1:0", undefined],
    ["anthropic.claude-sonnet-4-5-20250929-v1:0", "1h"],
    ["us.anthropic.claude-haiku-4-5-20251001-v1:0", "1h"],
    ["global.anthropic.claude-opus-4-6-v1", "1h"],
    ["anthropic.claude-opus-4-8", "1h"],
    ["anthropic.claude-sonnet-5", "1h"],
    ["anthropic.claude-fable-5-1", "1h"],
    ["arn:aws:bedrock:us-east-1::foundation-model/anthropic.claude-sonnet-4-6", "1h"],
    ["arn:aws:bedrock:us-east-1:123456789012:inference-profile/us.anthropic.claude-sonnet-4-6", "1h"],
  ] as const) {
    it.effect(`preserves supported Claude checkpoints and TTL for ${id}`, () =>
      Effect.gen(function* () {
        const prepared = yield* compileRequest(
          LLM.request({
            model: bedrock.model(id),
            system: [
              { type: "text", text: "Agent" },
              { type: "text", text: "Project" },
            ],
            tools: [{ name: "lookup", description: "Lookup", inputSchema: { type: "object" } }],
            prompt: "Question",
            cache: { tools: true, system: true, messages: { tail: 1 }, ttlSeconds: 3600 },
          }),
        )
        const marker = { cachePoint: ttl === undefined ? { type: "default" } : { type: "default", ttl } }

        expect(prepared.body).toMatchObject({
          modelId: id,
          toolConfig: { tools: [{ toolSpec: { name: "lookup" } }, marker] },
          system: [{ text: "Agent" }, marker, { text: "Project" }, marker],
          messages: [{ role: "user", content: [{ text: "Question" }, marker] }],
        })
      }),
    )
  }

  for (const id of [
    "amazon.nova-micro-v1:0",
    "us.amazon.nova-lite-v1:0",
    "eu.amazon.nova-pro-v1:0",
    "amazon.nova-premier-v1:0",
    "jp.amazon.nova-2-lite-v1:0",
    "global.amazon.nova-2-lite-v1:0",
  ]) {
    it.effect(`limits Nova checkpoints to system/messages with the default TTL for ${id}`, () =>
      Effect.gen(function* () {
        const prepared = yield* compileRequest(
          LLM.request({
            model: bedrock.model(id),
            system: "System prefix",
            tools: [{ name: "lookup", description: "Lookup", inputSchema: { type: "object" } }],
            prompt: "Question",
            cache: { tools: true, system: true, messages: { tail: 1 }, ttlSeconds: 3600 },
          }),
        )

        expect(prepared.body).toMatchObject({
          toolConfig: { tools: [{ toolSpec: { name: "lookup" } }] },
          system: [{ text: "System prefix" }, { cachePoint: { type: "default" } }],
          messages: [{ role: "user", content: [{ text: "Question" }, { cachePoint: { type: "default" } }] }],
        })
      }),
    )
  }

  it.effect("unsupported Nova tool checkpoints do not consume the message checkpoint budget", () =>
    Effect.gen(function* () {
      const cache = new CacheHint({ type: "ephemeral", ttlSeconds: 3600 })
      const prepared = yield* compileRequest(
        LLM.request({
          model: bedrock.model("amazon.nova-lite-v1:0"),
          cache: "none",
          tools: ["one", "two", "three", "four"].map((name) => ({
            name,
            description: name,
            inputSchema: { type: "object" },
            cache,
          })),
          system: [{ type: "text", text: "System prefix", cache }],
          messages: [
            Message.user("Question"),
            Message.assistant([ToolCallPart.make({ id: "call_1", name: "one", input: {} })]),
            Message.tool({ id: "call_1", name: "one", result: "Result", cache }),
          ],
        }),
      )

      expect(JSON.stringify(prepared.body.toolConfig)).not.toContain("cachePoint")
      expect(prepared.body.system).toEqual([{ text: "System prefix" }, { cachePoint: { type: "default" } }])
      expect(prepared.body.messages.at(-1)).toMatchObject({
        role: "user",
        content: [{ toolResult: { toolUseId: "call_1" } }, { cachePoint: { type: "default" } }],
      })
    }),
  )

  for (const api of ["chat", "responses"] as const) {
    it.effect(`Mantle ${api} does not emit Converse checkpoints`, () =>
      Effect.gen(function* () {
        const prepared = yield* compileRequest(
          LLM.request({
            model: AmazonBedrockMantle.configure({ apiKey: "fixture" })[api]("openai.gpt-oss-120b"),
            system: "System prefix",
            prompt: "Question",
          }),
        )
        expect(JSON.stringify(prepared.body)).not.toContain("cachePoint")
      }),
    )
  }
})
