import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { CacheHint, LLM, Message, ToolCallPart } from "../../src/index.js"
import { AmazonBedrock } from "../../src/providers.js"
import { compileRequest } from "../../src/route/client.js"
import { it } from "../lib/effect.js"

const bedrock = AmazonBedrock.configure({ apiKey: "fixture" })

describe("Bedrock Converse cache policy", () => {
  for (const id of [
    "deepseek.r1-v1:0",
    "meta.llama3-3-70b-instruct-v1:0",
    "mistral.mistral-large-2402-v1:0",
    "qwen.qwen3-coder-480b-a35b-v1:0",
    "openai.gpt-oss-120b-1:0",
    "cohere.command-r-v1:0",
    "anthropic.claude-instant-v1",
    "anthropic.claude-v1",
    "anthropic.claude-v2",
    "anthropic.claude-v2:1",
    "anthropic.claude-3-haiku-20240307-v1:0",
    "anthropic.claude-3-sonnet-20240229-v1:0",
    "anthropic.claude-3-opus-20240229-v1:0",
    "anthropic.claude-3-5-sonnet-20240620-v1:0",
    "amazon.nova-lite-v1:0",
    "global.amazon.nova-2-lite-v1:0",
    "custom-model",
    "arn:aws:bedrock:us-east-1:123456789012:application-inference-profile/abc123",
  ]) {
    for (const policy of [undefined, "auto", "none", { tools: true, system: true, messages: { tail: 3 } }] as const) {
      it.effect(`omits checkpoints for ${id} (${JSON.stringify(policy)})`, () =>
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
    ["anthropic.claude-opus-4-20250514-v1:0", undefined],
    ["anthropic.claude-opus-4-1-20250805-v1:0", undefined],
    ["anthropic.claude-sonnet-4-5-20250929-v1:0", "1h"],
    ["global.anthropic.claude-sonnet-99", "1h"],
    ["anthropic.claude-new-family-99", "1h"],
    ["arn:aws:bedrock:us-east-1::foundation-model/anthropic.claude-sonnet-4-6", "1h"],
    ["arn:aws:bedrock:us-east-1:123456789012:inference-profile/us.anthropic.claude-sonnet-4-6", "1h"],
  ] as const) {
    for (const ttlSeconds of [undefined, 3600]) {
      it.effect(`preserves Claude checkpoints for ${id} (TTL: ${ttlSeconds ?? "default"})`, () =>
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
              cache:
                ttlSeconds === undefined ? undefined : { tools: true, system: true, messages: { tail: 1 }, ttlSeconds },
            }),
          )
          const marker = {
            cachePoint: ttlSeconds === undefined || ttl === undefined ? { type: "default" } : { type: "default", ttl },
          }

          expect(prepared.body).toMatchObject({
            modelId: id,
            toolConfig: { tools: [{ toolSpec: { name: "lookup" } }, marker] },
            system: [{ text: "Agent" }, marker, { text: "Project" }, marker],
            messages: [{ role: "user", content: [{ text: "Question" }, marker] }],
          })
          if (ttlSeconds === undefined || ttl === undefined)
            expect(JSON.stringify(prepared.body)).not.toContain('"ttl"')
        }),
      )
    }
  }
})
