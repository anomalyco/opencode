import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { ai, CacheHint, CompactionPart, Message, ProviderID, ToolCallPart } from "../src/effect.js"
import { Auth } from "../src/route.js"
import { compileRequest } from "../src/route/client.js"
import {
  Alibaba,
  AmazonBedrock,
  AnthropicCompatible,
  CloudflareAIGateway,
  DigitalOcean,
  GoogleVertexMessages,
  Meta,
  MiniMax,
  Moonshot,
  OpenRouter,
  ZAICodingPlan,
} from "../src/providers.js"
import * as AnthropicMessages from "../src/protocols/anthropic-messages.js"
import * as Gemini from "../src/protocols/gemini.js"
import * as OpenAIChat from "../src/protocols/openai-chat.js"
import { applyCachePolicy } from "../src/cache-policy.js"
import { it } from "./lib/effect.js"

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
        ai.request({
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

  it.effect("'auto' on Anthropic marks the last tool, the last system part, the tail, and the previous tail", () =>
    Effect.gen(function* () {
      const prepared = yield* compileRequest(
        ai.request({
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

      expect(prepared.body).toEqual(
        expect.objectContaining({
          tools: [expect.objectContaining({ name: "t1", cache_control: { type: "ephemeral" } })],
          system: [
            { type: "text", text: "Base agent" },
            { type: "text", text: "Project instructions", cache_control: { type: "ephemeral" } },
          ],
          // The previous request ended at "first user" and wrote its tail entry there.
          messages: [
            { role: "user", content: [{ type: "text", text: "first user", cache_control: { type: "ephemeral" } }] },
            { role: "assistant", content: [{ type: "text", text: "assistant reply" }] },
            {
              role: "user",
              content: [{ type: "text", text: "latest user message", cache_control: { type: "ephemeral" } }],
            },
          ],
        }),
      )
    }),
  )

  it.effect("'auto' on Anthropic keeps the first system part's breakpoint while a slot is left", () =>
    Effect.gen(function* () {
      const prepared = yield* compileRequest(
        ai.request({
          model: anthropicModel,
          system: [
            { type: "text", text: "Base agent" },
            { type: "text", text: "Project instructions" },
          ],
          tools: [{ name: "t1", description: "t1", inputSchema: { type: "object", properties: {} } }],
          prompt: "first prompt",
          cache: "auto",
        }),
      )

      expect(prepared.body).toMatchObject({
        system: [
          { type: "text", text: "Base agent", cache_control: { type: "ephemeral" } },
          { type: "text", text: "Project instructions", cache_control: { type: "ephemeral" } },
        ],
        messages: [
          { role: "user", content: [{ type: "text", text: "first prompt", cache_control: { type: "ephemeral" } }] },
        ],
      })
    }),
  )

  it.effect("'auto' on Anthropic keeps the previous tail marked when one new message has many blocks", () =>
    Effect.gen(function* () {
      const attachments = Array.from({ length: 24 }, (_, index) => Message.text(`Attached file: f${index}.md`))
      const prepared = yield* compileRequest(
        ai.request({
          model: anthropicModel,
          messages: [
            Message.user("start"),
            Message.assistant([ToolCallPart.make({ id: "tc_1", name: "lookup", input: {} })]),
            Message.tool({ id: "tc_1", name: "lookup", result: "found" }),
            Message.assistant("Done."),
            Message.user([Message.text("look at these"), ...attachments]),
          ],
          cache: "auto",
        }),
      )

      const body = prepared.body as { messages: Array<{ content: Array<{ cache_control?: unknown }> }> }
      // The previous request ended at the tool result, 26 positions before the new tail breakpoint.
      expect(body.messages[2]?.content[0]?.cache_control).toEqual({ type: "ephemeral" })
      expect(body.messages[3]?.content[0]?.cache_control).toBeUndefined()
      expect(body.messages[4]?.content.at(-1)?.cache_control).toEqual({ type: "ephemeral" })
    }),
  )

  it.effect("'auto' on Anthropic marks the previous tail, not another result of the same step", () =>
    Effect.gen(function* () {
      const call = (id: string) => ToolCallPart.make({ id, name: "lookup", input: {} })
      const result = (id: string) => Message.tool({ id, name: "lookup", result: "found" })
      const prepared = yield* compileRequest(
        ai.request({
          model: anthropicModel,
          messages: [
            Message.user("start"),
            Message.assistant([call("tc_1"), call("tc_2"), call("tc_3")]),
            result("tc_1"),
            result("tc_2"),
            result("tc_3"),
          ],
          cache: "auto",
        }),
      )

      const body = prepared.body as { messages: Array<{ content: Array<{ cache_control?: unknown }> }> }
      // The three results lower into one user turn; the previous request ended at "start".
      expect(body.messages.map((message) => message.content.map((part) => part.cache_control))).toEqual([
        [{ type: "ephemeral" }],
        [undefined, undefined, undefined],
        [undefined, undefined, { type: "ephemeral" }],
      ])
    }),
  )

  it.effect("a message with nothing that carries a marker leaves its slot to the system prompt", () =>
    Effect.gen(function* () {
      const prepared = yield* compileRequest(
        ai.request({
          model: anthropicModel,
          system: [
            { type: "text", text: "Base agent" },
            { type: "text", text: "Project instructions" },
          ],
          tools: [{ name: "lookup", description: "lookup", inputSchema: { type: "object", properties: {} } }],
          messages: [
            Message.user("start"),
            Message.assistant([
              { type: "reasoning", text: "thinking", encrypted: "signature" },
              ToolCallPart.make({ id: "tc_1", name: "lookup", input: {} }),
            ]),
            Message.tool({ id: "tc_1", name: "lookup", result: "found" }),
          ],
          cache: { tools: true, system: true, messages: { tail: 2 } },
        }),
      )

      const body = prepared.body as {
        system: Array<{ cache_control?: unknown }>
        messages: Array<{ content: Array<{ cache_control?: unknown }> }>
      }
      // Thinking and tool_use blocks never carry cache_control, so the reply takes no slot.
      expect(body.messages[1]?.content.map((part) => part.cache_control)).toEqual([undefined, undefined])
      expect(body.messages[2]?.content[0]?.cache_control).toEqual({ type: "ephemeral" })
      expect(body.system.map((part) => part.cache_control)).toEqual([{ type: "ephemeral" }, { type: "ephemeral" }])
    }),
  )

  it.effect("auto hints never put a shorter lifetime before a manual one", () =>
    Effect.gen(function* () {
      const prepared = yield* compileRequest(
        ai.request({
          model: anthropicModel,
          system: [
            { type: "text", text: "Base agent" },
            { type: "text", text: "Project instructions" },
          ],
          tools: [{ name: "t1", description: "t1", inputSchema: { type: "object", properties: {} } }],
          messages: [
            Message.user("first user"),
            Message.assistant("assistant reply"),
            Message.user([{ ...Message.text("latest"), cache: new CacheHint({ type: "ephemeral", ttl: "1h" }) }]),
          ],
          cache: "auto",
        }),
      )

      const body = prepared.body as {
        tools: Array<{ cache_control?: unknown }>
        system: Array<{ cache_control?: unknown }>
        messages: Array<{ content: Array<{ cache_control?: unknown }> }>
      }
      // Anthropic rejects a ttl="1h" marker after a 5m one. Everything before the manual hint is written for an
      // hour anyway, so the earlier markers cost the same at 1h.
      const hour = { type: "ephemeral", ttl: "1h" }
      expect(body.tools[0]?.cache_control).toEqual(hour)
      expect(body.system.map((part) => part.cache_control)).toEqual([undefined, hour])
      expect(body.messages.map((message) => message.content[0]?.cache_control)).toEqual([hour, undefined, hour])
    }),
  )

  it.effect("a manual hint takes the longer lifetime of a marker after it", () =>
    Effect.gen(function* () {
      const prepared = yield* compileRequest(
        ai.request({
          model: anthropicModel,
          system: "Base agent",
          messages: [
            Message.user([{ ...Message.text("pinned"), cache: new CacheHint({ type: "ephemeral", ttl: "5m" }) }]),
            Message.assistant("first reply"),
            Message.user("second user"),
            Message.assistant("second reply"),
            Message.user("latest"),
          ],
          cache: { ttl: "1h" },
        }),
      )

      const body = prepared.body as {
        system: Array<{ cache_control?: unknown }>
        messages: Array<{ content: Array<{ cache_control?: unknown }> }>
      }
      // The tail and the previous tail go out at 1h after the manual 5m hint, which Anthropic rejects. Everything up
      // to the last 1h marker is written for an hour anyway, so the manual hint takes the hour at no cost.
      const hour = { type: "ephemeral", ttl: "1h" }
      expect(body.system[0]?.cache_control).toEqual(hour)
      expect(body.messages.map((message) => message.content[0]?.cache_control)).toEqual([
        hour,
        undefined,
        hour,
        undefined,
        hour,
      ])
    }),
  )

  it.effect("a manual tool hint takes the longer lifetime of the markers after it", () =>
    Effect.gen(function* () {
      const prepared = yield* compileRequest(
        ai.request({
          model: anthropicModel,
          system: "Base agent",
          tools: [
            {
              name: "t1",
              description: "t1",
              inputSchema: { type: "object", properties: {} },
              cache: new CacheHint({ type: "ephemeral", ttl: "5m" }),
            },
            { name: "t2", description: "t2", inputSchema: { type: "object", properties: {} } },
          ],
          prompt: "hi",
          cache: { ttl: "1h" },
        }),
      )

      const body = prepared.body as {
        tools: Array<{ cache_control?: unknown }>
        system: Array<{ cache_control?: unknown }>
        messages: Array<{ content: Array<{ cache_control?: unknown }> }>
      }
      const hour = { type: "ephemeral", ttl: "1h" }
      expect(body.tools.map((tool) => tool.cache_control)).toEqual([hour, hour])
      expect(body.system[0]?.cache_control).toEqual(hour)
      expect(body.messages[0]?.content[0]?.cache_control).toEqual(hour)
    }),
  )

  it.effect("lifetimes stay in send order when a system update moves after the next user turn", () =>
    Effect.gen(function* () {
      const prepared = yield* compileRequest(
        ai.request({
          // Opus 4.8 takes native system messages, which go out after the user turn that follows them.
          model: AnthropicMessages.route
            .with({ endpoint: { baseURL: "https://api.anthropic.test/v1/" }, auth: Auth.header("x-api-key", "test") })
            .model({ id: "claude-opus-4-8" }),
          system: [
            { type: "text", text: "Base agent" },
            { type: "text", text: "Project instructions" },
          ],
          tools: [{ name: "t1", description: "t1", inputSchema: { type: "object", properties: {} } }],
          messages: [
            Message.user("first user"),
            Message.assistant("assistant reply"),
            Message.system([
              { type: "text", text: "Use parameterized SQL.", cache: new CacheHint({ type: "ephemeral", ttl: "1h" }) },
            ]),
            Message.user("latest"),
          ],
          cache: "auto",
        }),
      )

      const body = prepared.body as {
        tools: Array<{ cache_control?: unknown }>
        system: Array<{ cache_control?: unknown }>
        messages: Array<{ role: string; content: Array<{ cache_control?: unknown }> }>
      }
      // The tail sits after the update in the request but goes out before it, so it takes the update's hour too.
      const hour = { type: "ephemeral", ttl: "1h" }
      expect(body.tools[0]?.cache_control).toEqual(hour)
      expect(body.system.map((part) => part.cache_control)).toEqual([undefined, hour])
      expect(body.messages.map((message) => [message.role, message.content[0]?.cache_control])).toEqual([
        ["user", undefined],
        ["assistant", undefined],
        ["user", hour],
        ["system", hour],
      ])
    }),
  )

  it.effect("lifetimes follow the body when a held system update goes out before a reply", () =>
    Effect.gen(function* () {
      const hour = new CacheHint({ type: "ephemeral", ttl: "1h" })
      const five = new CacheHint({ type: "ephemeral", ttl: "5m" })
      const prepared = yield* compileRequest(
        ai.request({
          model: AnthropicMessages.route
            .with({ endpoint: { baseURL: "https://api.anthropic.test/v1/" }, auth: Auth.header("x-api-key", "test") })
            .model({ id: "claude-opus-4-8" }),
          system: "Base agent",
          messages: [
            Message.user("first user"),
            Message.system([
              { type: "text", text: "Use parameterized SQL.", cache: hour },
              { type: "text", text: "Prefer small diffs.", cache: five },
            ]),
            Message.assistant([{ ...Message.text("Understood."), cache: five }]),
            Message.user("latest"),
          ],
          cache: "auto",
        }),
      )

      const body = prepared.body as {
        system: Array<{ cache_control?: unknown }>
        messages: Array<{ role: string; content: Array<{ cache_control?: unknown }> }>
      }
      // The reply's blocks are lowered before the held update, which goes out ahead of them.
      expect(body.system[0]?.cache_control).toEqual({ type: "ephemeral", ttl: "1h" })
      expect(
        body.messages.map((message) => [message.role, message.content.map((block) => block.cache_control)]),
      ).toEqual([
        ["user", [undefined]],
        [
          "system",
          [
            { type: "ephemeral", ttl: "1h" },
            { type: "ephemeral", ttl: "5m" },
          ],
        ],
        ["assistant", [{ type: "ephemeral", ttl: "5m" }]],
        ["user", [undefined]],
      ])
    }),
  )

  it.effect("a wrapped system update keeps its marker when its last part is blank", () =>
    Effect.gen(function* () {
      const prepared = yield* compileRequest(
        ai.request({
          model: anthropicModel,
          messages: [
            Message.user("first user"),
            Message.system([
              { type: "text", text: "Use parameterized SQL." },
              { type: "text", text: " " },
            ]),
          ],
          cache: "auto",
        }),
      )

      const body = prepared.body as { messages: Array<{ content: Array<{ cache_control?: unknown }> }> }
      // The tail hint lands on the last non-blank part; the update is wrapped into the user turn as one block.
      expect(body.messages.map((message) => message.content.map((block) => block.cache_control))).toEqual([
        [undefined, { type: "ephemeral" }],
      ])
    }),
  )

  it.effect("gateway and Bedrock markers before a manual 1h hint take its hour", () =>
    Effect.gen(function* () {
      const input = {
        system: "Base agent",
        tools: [{ name: "t1", description: "t1", inputSchema: { type: "object" as const, properties: {} } }],
        messages: [
          Message.user("first user"),
          Message.assistant("assistant reply"),
          Message.user([{ ...Message.text("latest"), cache: new CacheHint({ type: "ephemeral", ttl: "1h" }) }]),
        ],
        cache: "auto" as const,
      }
      const gateway = yield* compileRequest(
        ai.request({
          ...input,
          model: OpenRouter.configure({ apiKey: "test", baseURL: "https://openrouter.test/api/v1" }).model(
            "anthropic/claude-sonnet-4.5",
          ),
        }),
      )
      const bedrock = yield* compileRequest(
        ai.request({
          ...input,
          model: AmazonBedrock.configure({
            credentials: { region: "us-east-1", accessKeyId: "fixture", secretAccessKey: "fixture" },
          }).model("anthropic.claude-sonnet-4-5-20250929-v1:0"),
        }),
      )

      const hour = { type: "ephemeral", ttl: "1h" }
      const gatewayBody = gateway.body as {
        tools: Array<{ cache_control?: unknown }>
        messages: Array<{ content: unknown }>
      }
      expect(gatewayBody.tools[0]?.cache_control).toEqual(hour)
      expect(gatewayBody.messages[0]?.content).toEqual([{ type: "text", text: "Base agent", cache_control: hour }])
      expect(gatewayBody.messages.at(-1)?.content).toEqual([{ type: "text", text: "latest", cache_control: hour }])

      const point = { cachePoint: { type: "default", ttl: "1h" } }
      const bedrockBody = bedrock.body as {
        toolConfig: { tools: Array<unknown> }
        system: Array<unknown>
        messages: Array<{ content: Array<unknown> }>
      }
      expect(bedrockBody.toolConfig.tools.at(-1)).toEqual(point)
      expect(bedrockBody.system.at(-1)).toEqual(point)
      expect(bedrockBody.messages.at(-1)?.content.at(-1)).toEqual(point)
    }),
  )

  it.effect("'auto' keeps the first and last system parts and one message boundary off Anthropic's own API", () =>
    Effect.gen(function* () {
      const prepared = yield* compileRequest(
        ai.request({
          model: AnthropicCompatible.configure({ baseURL: "https://compatible.test/v1/", apiKey: "test" }).model(
            "claude-compatible",
          ),
          system: [
            { type: "text", text: "Base agent" },
            { type: "text", text: "Project instructions" },
          ],
          messages: [Message.user("first user"), Message.assistant("assistant reply"), Message.user("latest")],
          cache: "auto",
        }),
      )

      const body = prepared.body as {
        system: Array<{ cache_control?: unknown }>
        messages: Array<{ content: Array<{ cache_control?: unknown }> }>
      }
      expect(body.system.map((part) => part.cache_control)).toEqual([{ type: "ephemeral" }, { type: "ephemeral" }])
      expect(body.messages[1]?.content[0]?.cache_control).toBeUndefined()
      expect(body.messages[2]?.content[0]?.cache_control).toEqual({ type: "ephemeral" })
    }),
  )

  it.effect("'auto' emits Anthropic cache markers on Vertex", () =>
    Effect.gen(function* () {
      const prepared = yield* compileRequest(
        ai.request({
          model: GoogleVertexMessages.configure({ accessToken: "test", location: "global", project: "test" }).model(
            "claude-opus-4-8",
          ),
          system: "You are concise.",
          tools: [{ name: "lookup", description: "Look up a value", inputSchema: { type: "object", properties: {} } }],
          prompt: "hi",
        }),
      )

      expect(prepared.body).toMatchObject({
        tools: [{ name: "lookup", cache_control: { type: "ephemeral" } }],
        system: [{ type: "text", text: "You are concise.", cache_control: { type: "ephemeral" } }],
        messages: [{ role: "user", content: [{ type: "text", text: "hi", cache_control: { type: "ephemeral" } }] }],
      })
    }),
  )

  it.effect("'auto' emits cache_control markers on DigitalOcean", () =>
    Effect.gen(function* () {
      const prepared = yield* compileRequest(
        ai.request({
          model: DigitalOcean.configure({ apiKey: "test" }).model("anthropic-claude-fable-5.1"),
          system: "You are concise.",
          tools: [{ name: "lookup", description: "Look up a value", inputSchema: { type: "object", properties: {} } }],
          prompt: "hi",
        }),
      )

      expect(prepared.body).toMatchObject({
        tools: [{ type: "function", function: { name: "lookup" }, cache_control: { type: "ephemeral" } }],
        messages: [
          {
            role: "system",
            content: [{ text: "You are concise.", cache_control: { type: "ephemeral" } }],
          },
          {
            role: "user",
            content: [{ text: "hi", cache_control: { type: "ephemeral" } }],
          },
        ],
      })
    }),
  )

  it.effect("Alibaba chat caches the system and conversation tail without marking tools", () =>
    Effect.gen(function* () {
      const prepared = yield* compileRequest(
        ai.request({
          model: Alibaba.configure({ region: "ap-southeast-1", apiKey: "test" }).chat("qwen3.8-max"),
          system: "You are concise.",
          tools: [{ name: "lookup", description: "Look up a value", inputSchema: { type: "object", properties: {} } }],
          prompt: "hi",
        }),
      )

      expect(prepared.body).toMatchObject({
        tools: [{ type: "function", function: { name: "lookup" } }],
        messages: [
          {
            role: "system",
            content: [{ text: "You are concise.", cache_control: { type: "ephemeral" } }],
          },
          { role: "user", content: [{ text: "hi", cache_control: { type: "ephemeral" } }] },
        ],
      })
      expect(prepared.body.tools?.[0]?.cache_control).toBeUndefined()
    }),
  )

  it.effect("Alibaba chat omits automatic cache markers when cache is none", () =>
    Effect.gen(function* () {
      const prepared = yield* compileRequest(
        ai.request({
          model: Alibaba.configure({ region: "ap-southeast-1", apiKey: "test" }).chat("qwen3.8-max"),
          system: "You are concise.",
          prompt: "hi",
          cache: "none",
        }),
      )

      expect(JSON.stringify(prepared.body)).not.toContain("cache_control")
    }),
  )

  it.effect("Alibaba chat does not assume non-Qwen models support cache markers", () =>
    Effect.gen(function* () {
      const alibaba = Alibaba.configure({ region: "ap-southeast-1", apiKey: "test" })
      for (const modelID of ["kimi-k3", "glm-5.2", "deepseek-v4-flash-0731", "MiniMax-M2.5"]) {
        const prepared = yield* compileRequest(
          ai.request({ model: alibaba.chat(modelID), system: "You are concise.", prompt: "hi" }),
        )

        expect(JSON.stringify(prepared.body)).not.toContain("cache_control")
      }
    }),
  )

  it.effect("'auto' emits Anthropic cache markers on Anthropic-compatible routes", () =>
    Effect.gen(function* () {
      const prepared = yield* compileRequest(
        ai.request({
          model: AnthropicCompatible.configure({ apiKey: "test", baseURL: "https://messages.example.test/v1" }).model(
            "compatible",
          ),
          system: "You are concise.",
          prompt: "hi",
        }),
      )

      expect(prepared.route).toBe("anthropic-compatible-messages")
      expect(prepared.body).toMatchObject({
        system: [{ type: "text", text: "You are concise.", cache_control: { type: "ephemeral" } }],
        messages: [{ role: "user", content: [{ type: "text", text: "hi", cache_control: { type: "ephemeral" } }] }],
      })
    }),
  )

  const messagesModels = [
    ["alibaba-messages", Alibaba.configure({ region: "ap-southeast-1", apiKey: "test" }).messages("qwen3.8-max")],
    [
      "cloudflare-ai-gateway-messages",
      CloudflareAIGateway.configure({ accountId: "test", gatewayId: "test", apiKey: "test" }).model(
        "anthropic/claude-sonnet-4-6",
      ),
    ],
    ["meta-messages", Meta.configure({ apiKey: "test" }).messages("muse-spark-1.3")],
    ["minimax-messages", MiniMax.configure({ apiKey: "test" }).model("MiniMax-M3")],
    ["moonshot-messages", Moonshot.configure({ apiKey: "test" }).messages("kimi-k3")],
    ["zai-coding-messages", ZAICodingPlan.configure({ apiKey: "test" }).messages("glm-5.3")],
  ] as const

  messagesModels.forEach(([route, model]) =>
    it.effect(`'auto' emits cache markers on ${route}`, () =>
      Effect.gen(function* () {
        const prepared = yield* compileRequest(ai.request({ model, system: "Sys", prompt: "hi" }))

        expect(prepared.route).toBe(route)
        expect(prepared.body).toMatchObject({
          system: [{ type: "text", text: "Sys", cache_control: { type: "ephemeral" } }],
          messages: [{ role: "user", content: [{ type: "text", text: "hi", cache_control: { type: "ephemeral" } }] }],
        })
      }),
    ),
  )

  it.effect("'auto' is a no-op on OpenAI (implicit caching protocol)", () =>
    Effect.gen(function* () {
      const prepared = yield* compileRequest(
        ai.request({
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
        ai.request({
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
        ai.request({
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
        ai.request({
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
        ai.request({
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

  it.effect("deduplicates tools before counting cache hints", () =>
    Effect.gen(function* () {
      const manual = new CacheHint({ type: "ephemeral" })
      const duplicate = (description: string) => ({
        name: "lookup",
        description,
        inputSchema: { type: "object" },
        cache: manual,
      })
      const prepared = yield* compileRequest(
        ai.request({
          model: anthropicModel,
          prompt: "Hello",
          tools: [
            duplicate("first"),
            duplicate("second"),
            duplicate("third"),
            duplicate("fourth"),
            { name: "lookup", description: "final", inputSchema: { type: "object" } },
          ],
          cache: { tools: true },
        }),
      )

      expect(prepared.body.tools).toEqual([
        expect.objectContaining({ name: "lookup", description: "final", cache_control: { type: "ephemeral" } }),
      ])
    }),
  )

  it.effect("auto policy preserves manual CacheHints on other parts", () =>
    Effect.gen(function* () {
      const prepared = yield* compileRequest(
        ai.request({
          model: anthropicModel,
          system: [
            { type: "text", text: "first system", cache: new CacheHint({ type: "ephemeral", ttl: "1h" }) },
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
      const request = ai.request({
        model: anthropicModel,
        system: [
          { type: "text", text: "Base agent" },
          {
            type: "text",
            text: "Manual context",
            cache: new CacheHint({ type: "ephemeral", ttl: "1h" }),
          },
          { type: "text", text: "Project instructions" },
        ],
        tools: [{ name: "t1", description: "t1", inputSchema: { type: "object", properties: {} } }],
        prompt: "hi",
        cache: "auto",
      })
      const applied = applyCachePolicy(request)
      expect(applied.tools[0]?.cache).toBeDefined()
      // The conversation tail outranks the first system part when a manual hint takes a slot.
      expect(applied.system.map((part) => part.cache !== undefined)).toEqual([false, true, true])
      const tail = applied.messages[0]!.content[0]!
      expect("cache" in tail ? tail.cache : undefined).toBeDefined()
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
      // Only the tools marker comes before the manual 1h hint; the markers after it keep the default lifetime.
      expect(body.tools[0]?.cache_control).toEqual({ type: "ephemeral", ttl: "1h" })
      expect(body.system[1]?.cache_control).toEqual({ type: "ephemeral", ttl: "1h" })
      expect(body.system[2]?.cache_control).toEqual({ type: "ephemeral" })
      expect(body.messages[0]?.content[0]?.cache_control).toEqual({ type: "ephemeral" })
    }),
  )

  it.effect("a tail that outgrows the budget keeps the newest messages", () =>
    Effect.gen(function* () {
      const prepared = yield* compileRequest(
        ai.request({
          model: anthropicModel,
          system: [
            { type: "text", text: "Base agent" },
            { type: "text", text: "Project instructions" },
          ],
          messages: [Message.user("u1"), Message.assistant("a1"), Message.user("u2"), Message.assistant("a2")],
          cache: { system: true, messages: { tail: 3 } },
        }),
      )

      const body = prepared.body as {
        system: Array<{ cache_control?: unknown }>
        messages: Array<{ content: Array<{ cache_control?: unknown }> }>
      }
      expect(body.system.map((part) => part.cache_control)).toEqual([undefined, { type: "ephemeral" }])
      expect(body.messages.map((message) => message.content[0]?.cache_control)).toEqual([
        undefined,
        { type: "ephemeral" },
        { type: "ephemeral" },
        { type: "ephemeral" },
      ])
    }),
  )

  test("marks the final leaf inside a tool namespace", () => {
    const request = ai.request({
      model: anthropicModel,
      prompt: "Hello",
      tools: [
        {
          type: "namespace",
          name: "crm",
          tools: [
            { name: "lookup", description: "lookup", inputSchema: {} },
            { name: "orders", description: "orders", inputSchema: {} },
          ],
        },
      ],
      cache: { tools: true },
    })
    const applied = applyCachePolicy(request)
    const namespace = applied.tools[0]

    expect(namespace?.type).toBe("namespace")
    if (namespace?.type !== "namespace") throw new Error("Expected namespace")
    expect(namespace.tools[0]).not.toHaveProperty("cache")
    expect(namespace.tools[1]).toHaveProperty("cache", { type: "ephemeral" })
  })

  it.effect("a ttl-only policy keeps automatic placement", () =>
    Effect.gen(function* () {
      const prepared = yield* compileRequest(
        ai.request({ model: anthropicModel, system: "Sys", prompt: "hi", cache: { ttl: "1h" } }),
      )

      expect(prepared.body).toMatchObject({
        system: [{ type: "text", text: "Sys", cache_control: { type: "ephemeral", ttl: "1h" } }],
        messages: [
          { role: "user", content: [{ type: "text", text: "hi", cache_control: { type: "ephemeral", ttl: "1h" } }] },
        ],
      })
    }),
  )

  it.effect("ttl in the policy flows through to wire markers", () =>
    Effect.gen(function* () {
      const prepared = yield* compileRequest(
        ai.request({
          model: anthropicModel,
          system: "Sys",
          prompt: "hi",
          cache: { system: true, ttl: "1h" },
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
        ai.request({
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
        ai.request({
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

  test("skips parts that can't carry a marker when placing message breakpoints", () => {
    const compaction = CompactionPart.make({ provider: ProviderID.make("anthropic"), text: "summary" })
    const toolCall = ToolCallPart.make({ id: "tc_1", name: "lookup", input: {} })

    const mixed = ai.request({
      model: anthropicModel,
      messages: [Message.assistant([Message.text("Checking."), toolCall, compaction])],
      cache: { messages: "latest-assistant" },
    })
    const appliedMixed = applyCachePolicy(mixed)
    expect(appliedMixed.messages[0]?.content[0]).toMatchObject({
      type: "text",
      text: "Checking.",
      cache: { type: "ephemeral" },
    })
    expect(appliedMixed.messages[0]?.content[1]).toEqual(toolCall)
    expect(appliedMixed.messages[0]?.content[2]).toEqual(compaction)

    // No protocol sends cache_control on a tool call, so a message without text keeps its slot.
    const callOnly = ai.request({
      model: anthropicModel,
      messages: [Message.assistant([toolCall, compaction])],
      cache: { messages: "latest-assistant" },
    })
    expect(applyCachePolicy(callOnly)).toBe(callOnly)

    const compactionOnly = ai.request({
      model: anthropicModel,
      messages: [Message.assistant([compaction])],
      cache: { messages: "latest-assistant" },
    })
    expect(applyCachePolicy(compactionOnly)).toBe(compactionOnly)
  })

  test("returns the same request reference when policy is a no-op (pure function)", () => {
    const request = ai.request({
      model: anthropicModel,
      prompt: "hi",
      cache: "none",
    })
    expect(applyCachePolicy(request)).toBe(request)
  })
})
