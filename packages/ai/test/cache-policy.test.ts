import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { CacheHint, LLM, Message } from "../src"
import { Auth } from "../src/route"
import { compileRequest } from "../src/route/client"
import { AmazonBedrock } from "../src/providers"
import * as AnthropicMessages from "../src/protocols/anthropic-messages"
import * as Gemini from "../src/protocols/gemini"
import * as OpenAIChat from "../src/protocols/openai-chat"
import { applyCachePolicy } from "../src/cache-policy"
import { it } from "./lib/effect"

const anthropicModel = AnthropicMessages.route
  .with({ endpoint: { baseURL: "https://api.anthropic.test/v1/" }, auth: Auth.header("x-api-key", "test") })
  .model({ id: "claude-sonnet-4-5" })

const bedrockModel = AmazonBedrock.configure({
  credentials: { region: "us-east-1", accessKeyId: "fixture", secretAccessKey: "fixture" },
}).model("anthropic.claude-3-5-sonnet-20241022-v2:0")

const openaiModel = OpenAIChat.route
  .with({ endpoint: { baseURL: "https://api.openai.test/v1/" }, auth: Auth.bearer("test") })
  .model({ id: "gpt-4o-mini" })

const geminiModel = Gemini.route
  .with({
    endpoint: { baseURL: "https://generativelanguage.test/v1beta/" },
    auth: Auth.header("x-goog-api-key", "test"),
  })
  .model({ id: "gemini-2.5-flash" })

describe("applyCachePolicy", () => {
  it.effect("undefined cache resolves to 'auto' (the recommended default)", () =>
    Effect.gen(function* () {
      const prepared = yield* compileRequest(
        LLM.request({
          model: anthropicModel,
          system: "You are concise.",
          prompt: "hi",
        }),
      )

      // A single system block is both the first and last boundary, so the auto
      // policy deduplicates it and still marks the conversation tail.
      expect(prepared.body).toMatchObject({
        system: [{ type: "text", text: "You are concise.", cache_control: { type: "ephemeral" } }],
        messages: [{ role: "user", content: [{ type: "text", text: "hi", cache_control: { type: "ephemeral" } }] }],
      })
    }),
  )

  it.effect("'auto' marks the last tool, first and last system parts, and final message boundary on Anthropic", () =>
    Effect.gen(function* () {
      const prepared = yield* compileRequest(
        LLM.request({
          model: anthropicModel,
          system: [
            { type: "text", text: "Base agent" },
            { type: "text", text: "Project instructions" },
          ],
          tools: [{ name: "t1", description: "t1", inputSchema: { type: "object", properties: {} } }],
          messages: [
            Message.user("first user"),
            Message.assistant("assistant reply"),
            Message.user("latest user message"),
          ],
          cache: "auto",
        }),
      )

      expect(prepared.body).toMatchObject({
        tools: [{ name: "t1", cache_control: { type: "ephemeral" } }],
        system: [
          { type: "text", text: "Base agent", cache_control: { type: "ephemeral" } },
          { type: "text", text: "Project instructions", cache_control: { type: "ephemeral" } },
        ],
        messages: [
          { role: "user", content: [{ type: "text", text: "first user" }] },
          { role: "assistant", content: [{ type: "text", text: "assistant reply" }] },
          {
            role: "user",
            content: [{ type: "text", text: "latest user message", cache_control: { type: "ephemeral" } }],
          },
        ],
      })
    }),
  )

  it.effect("'auto' is a no-op on OpenAI (implicit caching protocol)", () =>
    Effect.gen(function* () {
      const prepared = yield* compileRequest(
        LLM.request({
          model: openaiModel,
          system: "Sys",
          prompt: "hi",
          cache: "auto",
        }),
      )

      const body = prepared.body as { messages: Array<{ content: unknown }> }
      // OpenAI doesn't accept cache_control on messages — policy must skip.
      const flat = JSON.stringify(body)
      expect(flat).not.toContain("cache_control")
      expect(flat).not.toContain("cachePoint")
    }),
  )

  it.effect("'auto' is a no-op on Gemini (out-of-band caching protocol)", () =>
    Effect.gen(function* () {
      const prepared = yield* compileRequest(
        LLM.request({
          model: geminiModel,
          system: "Sys",
          prompt: "hi",
          cache: "auto",
        }),
      )

      const flat = JSON.stringify(prepared.body)
      expect(flat).not.toContain("cache_control")
      expect(flat).not.toContain("cachePoint")
    }),
  )

  it.effect("'auto' on Bedrock emits cachePoint markers in the right places", () =>
    Effect.gen(function* () {
      const prepared = yield* compileRequest(
        LLM.request({
          model: bedrockModel,
          system: [
            { type: "text", text: "Base agent" },
            { type: "text", text: "Project instructions" },
          ],
          tools: [{ name: "t1", description: "t1", inputSchema: { type: "object", properties: {} } }],
          messages: [Message.user("first user"), Message.assistant("reply"), Message.user("latest user")],
          cache: "auto",
        }),
      )

      expect(prepared.body).toMatchObject({
        toolConfig: {
          tools: [{ toolSpec: { name: "t1" } }, { cachePoint: { type: "default" } }],
        },
        system: [
          { text: "Base agent" },
          { cachePoint: { type: "default" } },
          { text: "Project instructions" },
          { cachePoint: { type: "default" } },
        ],
        messages: [
          { role: "user", content: [{ text: "first user" }] },
          { role: "assistant", content: [{ text: "reply" }] },
          { role: "user", content: [{ text: "latest user" }, { cachePoint: { type: "default" } }] },
        ],
      })
    }),
  )

  it.effect("'none' disables auto placement even when manual hints exist", () =>
    Effect.gen(function* () {
      const prepared = yield* compileRequest(
        LLM.request({
          model: anthropicModel,
          system: "Sys",
          tools: [{ name: "t1", description: "t1", inputSchema: { type: "object", properties: {} } }],
          prompt: "hi",
          cache: "none",
        }),
      )

      expect(prepared.body).toMatchObject({
        tools: [{ name: "t1", cache_control: undefined }],
        system: [{ type: "text", text: "Sys", cache_control: undefined }],
      })
    }),
  )

  it.effect("granular object form: tools-only marks just tools", () =>
    Effect.gen(function* () {
      const prepared = yield* compileRequest(
        LLM.request({
          model: anthropicModel,
          system: "Sys",
          tools: [{ name: "t1", description: "t1", inputSchema: { type: "object", properties: {} } }],
          prompt: "hi",
          cache: { tools: true },
        }),
      )

      expect(prepared.body).toMatchObject({
        tools: [{ name: "t1", cache_control: { type: "ephemeral" } }],
        system: [{ type: "text", text: "Sys", cache_control: undefined }],
      })
    }),
  )

  it.effect("auto policy preserves manual CacheHints on other parts", () =>
    Effect.gen(function* () {
      const prepared = yield* compileRequest(
        LLM.request({
          model: anthropicModel,
          system: [
            { type: "text", text: "first system", cache: new CacheHint({ type: "ephemeral", ttlSeconds: 3600 }) },
            { type: "text", text: "last system" },
          ],
          prompt: "hi",
          cache: "auto",
        }),
      )

      const body = prepared.body as {
        system: Array<{ text: string; cache_control?: unknown }>
        messages: Array<{ content: Array<{ cache_control?: unknown }> }>
      }
      expect(body.system[0]?.cache_control).toEqual({ type: "ephemeral", ttl: "1h" })
      expect(body.system[1]?.cache_control).toEqual({ type: "ephemeral" })
      expect(body.messages[0]?.content[0]?.cache_control).toEqual({ type: "ephemeral" })
    }),
  )

  it.effect("auto policy stays within the four-breakpoint cap when preserving manual hints", () =>
    Effect.gen(function* () {
      const request = LLM.request({
        model: anthropicModel,
        system: [
          { type: "text", text: "Base agent" },
          {
            type: "text",
            text: "Manual context",
            cache: new CacheHint({ type: "ephemeral", ttlSeconds: 3600 }),
          },
          { type: "text", text: "Project instructions" },
        ],
        tools: [{ name: "t1", description: "t1", inputSchema: { type: "object", properties: {} } }],
        prompt: "hi",
        cache: "auto",
      })
      const applied = applyCachePolicy(request)
      expect(applied.tools[0]?.cache).toBeDefined()
      expect(applied.system.map((part) => part.cache !== undefined)).toEqual([true, true, true])
      const tail = applied.messages[0]!.content[0]!
      expect("cache" in tail ? tail.cache : undefined).toBeUndefined()
      expect(applyCachePolicy(applied)).toBe(applied)

      const prepared = yield* compileRequest(request)

      const body = prepared.body as {
        tools: Array<{ cache_control?: unknown }>
        system: Array<{ cache_control?: unknown }>
        messages: Array<{ content: Array<{ cache_control?: unknown }> }>
      }
      const marked = [
        ...body.tools.map((tool) => tool.cache_control),
        ...body.system.map((part) => part.cache_control),
        ...body.messages.flatMap((message) => message.content.map((part) => part.cache_control)),
      ].filter((cache) => cache !== undefined)
      expect(marked).toHaveLength(4)
      expect(body.system[1]?.cache_control).toEqual({ type: "ephemeral", ttl: "1h" })
      expect(body.messages[0]?.content[0]?.cache_control).toBeUndefined()
    }),
  )

  it.effect("ttlSeconds in the policy flows through to wire markers", () =>
    Effect.gen(function* () {
      const prepared = yield* compileRequest(
        LLM.request({
          model: anthropicModel,
          system: "Sys",
          prompt: "hi",
          cache: { system: true, ttlSeconds: 3600 },
        }),
      )

      expect(prepared.body).toMatchObject({
        system: [{ type: "text", text: "Sys", cache_control: { type: "ephemeral", ttl: "1h" } }],
      })
    }),
  )

  it.effect("messages: { tail: 2 } marks the last 2 message boundaries", () =>
    Effect.gen(function* () {
      const prepared = yield* compileRequest(
        LLM.request({
          model: anthropicModel,
          messages: [Message.user("u1"), Message.assistant("a1"), Message.user("u2"), Message.assistant("a2")],
          cache: { messages: { tail: 2 } },
        }),
      )

      const body = prepared.body as { messages: Array<{ content: Array<{ cache_control?: unknown }> }> }
      expect(body.messages[0]?.content[0]?.cache_control).toBeUndefined()
      expect(body.messages[1]?.content[0]?.cache_control).toBeUndefined()
      expect(body.messages[2]?.content[0]?.cache_control).toEqual({ type: "ephemeral" })
      expect(body.messages[3]?.content[0]?.cache_control).toEqual({ type: "ephemeral" })
    }),
  )

  it.effect("'latest-assistant' marks the last assistant message", () =>
    Effect.gen(function* () {
      const prepared = yield* compileRequest(
        LLM.request({
          model: anthropicModel,
          messages: [Message.user("u1"), Message.assistant("a1"), Message.user("u2")],
          cache: { messages: "latest-assistant" },
        }),
      )

      const body = prepared.body as { messages: Array<{ content: Array<{ cache_control?: unknown }> }> }
      expect(body.messages[0]?.content[0]?.cache_control).toBeUndefined()
      expect(body.messages[1]?.content[0]?.cache_control).toEqual({ type: "ephemeral" })
      expect(body.messages[2]?.content[0]?.cache_control).toBeUndefined()
    }),
  )

  test("returns the same request reference when policy is a no-op (pure function)", () => {
    const request = LLM.request({
      model: anthropicModel,
      prompt: "hi",
      cache: "none",
    })
    expect(applyCachePolicy(request)).toBe(request)
  })
})
