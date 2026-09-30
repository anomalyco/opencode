import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { CacheHint, LLM, Message } from "../../src/index.js"
import { LLMClient } from "../../src/route.js"
import { compileRequest } from "../../src/route/client.js"
import { OpenRouter } from "../../src/providers/openrouter.js"
import { it } from "../lib/effect.js"
import { fixedResponse } from "../lib/http.js"
import { sseEvents } from "../lib/sse.js"

describe("OpenRouter", () => {
  it.effect("routes OpenAI, xAI, and Meta models through the same namespace-aware Responses protocol", () =>
    Effect.forEach(["openai/gpt-4o-mini", "x-ai/grok-4.3", "meta/muse-spark-1.3", "~x-ai/grok-latest"], (id) =>
      Effect.gen(function* () {
        const model = OpenRouter.configure({
          apiKey: "test-key",
          providerOptions: {
            reasoning: { effort: "low", exclude: true, summary: "detailed" },
            text: { verbosity: "low", format: { type: "json_schema", name: "result", schema: { type: "object" } } },
            provider: { allow_fallbacks: false },
          },
        }).model(id)
        const prepared = yield* compileRequest(
          LLM.request({
            model,
            prompt: "Say hello.",
            tools: [
              {
                type: "namespace",
                name: "crm",
                tools: [
                  {
                    type: "namespace",
                    name: "contacts",
                    tools: [
                      {
                        name: "lookup",
                        description: "Look up a contact",
                        inputSchema: { type: "object", properties: {} },
                      },
                    ],
                  },
                ],
              },
            ],
          }),
        )

        expect(model.route.endpoint.baseURL).toBe("https://openrouter.ai/api/v1")
        expect(prepared.route).toBe("openrouter-responses")
        expect(model.route.protocol).toBe(OpenRouter.responses("openai/gpt-4o-mini").route.protocol)
        expect(prepared.body).toMatchObject({
          model: id,
          input: [{ role: "user", content: [{ type: "input_text", text: "Say hello." }] }],
          stream: true,
          store: false,
          include: ["reasoning.encrypted_content"],
          reasoning: { effort: "low", exclude: true, summary: "detailed" },
          text: { verbosity: "low", format: { type: "json_schema", name: "result", schema: { type: "object" } } },
          tools: [{ type: "namespace", name: "crm", tools: [{ type: "function", name: "contacts_lookup" }] }],
          provider: { allow_fallbacks: false },
        })
      }),
    ),
  )

  it.effect("exposes exactly three API routes and leaves other families on Chat", () =>
    Effect.gen(function* () {
      expect(OpenRouter.routes.map((route) => route.endpoint.path)).toEqual([
        "/chat/completions",
        "/responses",
        "/messages",
      ])
      const openrouter = OpenRouter.configure({ apiKey: "test-key" })
      const chat = openrouter.model("meta-llama/llama-3.3-70b-instruct")
      expect(chat.route.id).toBe("openrouter")
      expect(openrouter.model("qwen/qwen3-coder-plus").route.protocol).toBe(chat.route.protocol)
      expect(openrouter.messages("anthropic/claude-sonnet-4.6").route.id).toBe("openrouter-messages")
    }),
  )

  it.effect("places default cache breakpoints on tools, system boundaries, and the conversation tail", () =>
    Effect.gen(function* () {
      const prepared = yield* compileRequest(
        LLM.request({
          model: OpenRouter.configure({ apiKey: "test-key" }).model("anthropic/claude-sonnet-4.6"),
          system: [
            { type: "text", text: "Base agent" },
            { type: "text", text: "Model details" },
            { type: "text", text: "Project instructions" },
          ],
          tools: [
            { name: "read", description: "Read", inputSchema: { type: "object", properties: {} } },
            { name: "lookup", description: "Lookup", inputSchema: { type: "object", properties: {} } },
          ],
          prompt: "Hello",
        }),
      )

      expect(prepared.body.tools?.map((tool) => tool.cache_control)).toEqual([undefined, { type: "ephemeral" }])
      expect(prepared.route).toBe("openrouter-messages")
      expect(prepared.body.system).toMatchObject([
        { text: "Base agent", cache_control: { type: "ephemeral" } },
        { text: "Model details" },
        { text: "Project instructions", cache_control: { type: "ephemeral" } },
      ])
      expect(prepared.body.messages).toMatchObject([
        { role: "user", content: [{ text: "Hello", cache_control: { type: "ephemeral" } }] },
      ])
      expect(prepared.body.system).not.toContainEqual(
        expect.objectContaining({ text: "Model details", cache_control: expect.anything() }),
      )
    }),
  )

  it.effect("preserves gateway routing and lowers native effort updates without changing the baseline", () =>
    Effect.gen(function* () {
      const openrouter = OpenRouter.configure({
        apiKey: "test-key",
        providerOptions: { provider: { allow_fallbacks: false }, reasoning: { effort: "low", summary: "detailed" } },
      })
      const messages = [Message.effort({ previous: "high", effort: "low" }), Message.user("Hello")]
      const response = yield* compileRequest(LLM.request({ model: openrouter.model("openai/gpt-6.1-sol"), messages }))
      const message = yield* compileRequest(
        LLM.request({ model: openrouter.model("anthropic/claude-fable-5.1"), messages }),
      )

      expect(response.body).toMatchObject({
        provider: { allow_fallbacks: false },
        reasoning: { effort: "high", summary: "detailed" },
        input: [{ type: "configuration_update", reasoning: { effort: "low" } }, { role: "user" }],
      })
      expect(message.body).toMatchObject({
        provider: { allow_fallbacks: false },
        output_config: { effort: "high" },
        thinking: { type: "adaptive", block_binding: { prefix_mismatch_behavior: "drop_block" } },
        messages: [{ role: "system", content: [], output_config: { effort: "low" } }, { role: "user" }],
      })
    }),
  )

  it.effect("inherits OpenAI effort support and applies the gateway's truncation restriction", () =>
    Effect.forEach(
      [
        { id: "~openai/gpt-6.1-sol", supported: true },
        { id: "x-ai/grok-4.3", supported: false },
        { id: "meta/muse-spark-1.3", supported: false },
        { id: "openai/gpt-6-luna", supported: false, providerOptions: { reasoning: { mode: "pro" } } },
        { id: "openai/gpt-6-luna", supported: false, http: { body: { reasoning: { mode: "pro" } } } },
        { id: "openai/gpt-6-luna", supported: false, providerOptions: { contextManagement: [{ type: "compaction" }] } },
        { id: "openai/gpt-6-luna", supported: false, providerOptions: { truncation: "auto" } },
        { id: "openai/gpt-6-luna", supported: false, http: { body: { truncation: "auto" } } },
      ],
      (input) =>
        Effect.gen(function* () {
          const prepared = yield* compileRequest(
            LLM.request({
              model: OpenRouter.configure({
                apiKey: "test-key",
                providerOptions: { reasoning: { effort: "low" } },
              }).responses(input.id),
              messages: [
                Message.user("Before"),
                Message.effort({ previous: "high", effort: "low" }),
                Message.user("After"),
              ],
              providerOptions: input.providerOptions,
              http: input.http,
            }),
          )

          expect(
            prepared.body.input.filter((item) => "type" in item && item.type === "configuration_update"),
          ).toHaveLength(input.supported ? 1 : 0)
          expect(prepared.body.reasoning?.effort).toBe(input.supported ? "high" : "low")
        }),
    ),
  )

  it.effect("does not restore the current effort over a model-default history baseline", () =>
    Effect.gen(function* () {
      const prepared = yield* compileRequest(
        LLM.request({
          model: OpenRouter.configure({
            apiKey: "test-key",
            providerOptions: { reasoning: { effort: "low", exclude: true } },
          }).responses("openai/gpt-6-luna"),
          messages: [Message.user("Before"), Message.effort({ effort: "low" }), Message.user("After")],
        }),
      )

      expect(prepared.body.reasoning?.effort).toBeUndefined()
      expect(prepared.body.reasoning?.exclude).toBe(true)
      expect(prepared.body.input).toContainEqual({ type: "configuration_update", reasoning: { effort: "low" } })
    }),
  )

  it.effect("replays saved Chat reasoning details through the native APIs", () =>
    Effect.gen(function* () {
      const openrouter = OpenRouter.configure({ apiKey: "test-key" })
      const message = yield* compileRequest(
        LLM.request({
          model: openrouter.model("anthropic/claude-sonnet-4.6"),
          messages: [
            Message.assistant({
              type: "reasoning",
              text: "AB",
              providerMetadata: {
                openrouter: {
                  reasoningDetails: [
                    { type: "reasoning.text", text: "A", signature: "first" },
                    { type: "reasoning.text", text: "B", signature: "second" },
                    { type: "reasoning.encrypted", data: "redacted" },
                  ],
                },
              },
            }),
          ],
        }),
      )
      const response = yield* compileRequest(
        LLM.request({
          model: openrouter.model("meta/muse-spark-1.3"),
          messages: [
            Message.assistant({
              type: "reasoning",
              text: "Summary",
              providerMetadata: { openrouter: { reasoningDetails: [{ type: "reasoning.encrypted", data: "opaque" }] } },
            }),
          ],
        }),
      )

      expect(message.body.messages[0]?.content).toMatchObject([
        { type: "thinking", thinking: "A", signature: "first" },
        { type: "thinking", thinking: "B", signature: "second" },
        { type: "redacted_thinking", data: "redacted" },
      ])
      expect(response.body.input[0]).toMatchObject({ type: "reasoning", encrypted_content: "opaque" })
    }),
  )

  it.effect("places default cache breakpoints on OpenRouter latest-model aliases", () =>
    Effect.gen(function* () {
      const prepared = yield* compileRequest(
        LLM.request({
          model: OpenRouter.configure({ apiKey: "test-key" }).model("~anthropic/claude-sonnet-latest"),
          system: "Base agent",
          tools: [{ name: "lookup", description: "Lookup", inputSchema: { type: "object", properties: {} } }],
          prompt: "Hello",
        }),
      )

      expect(prepared.body.tools?.[0]?.cache_control).toEqual({ type: "ephemeral" })
      expect(prepared.body.system).toMatchObject([{ text: "Base agent", cache_control: { type: "ephemeral" } }])
      expect(prepared.body.messages).toMatchObject([
        { role: "user", content: [{ text: "Hello", cache_control: { type: "ephemeral" } }] },
      ])
    }),
  )

  it.effect("skips the tool breakpoint for Qwen, which caches tools with the system prompt", () =>
    Effect.gen(function* () {
      const prepared = yield* compileRequest(
        LLM.request({
          model: OpenRouter.configure({ apiKey: "test-key" }).model("qwen/qwen3-coder-plus"),
          system: "Base agent",
          tools: [{ name: "lookup", description: "Lookup", inputSchema: { type: "object", properties: {} } }],
          prompt: "Hello",
        }),
      )

      expect(prepared.body.tools?.[0]?.cache_control).toBeUndefined()
      expect(prepared.body.messages).toMatchObject([
        { role: "system", content: [{ text: "Base agent", cache_control: { type: "ephemeral" } }] },
        { role: "user", content: [{ text: "Hello", cache_control: { type: "ephemeral" } }] },
      ])
    }),
  )

  it.effect("places the default Qwen conversation-tail breakpoint inside tool-result text", () =>
    Effect.gen(function* () {
      const prepared = yield* compileRequest(
        LLM.request({
          model: OpenRouter.configure({ apiKey: "test-key" }).model("qwen/qwen3-coder-plus"),
          messages: [
            Message.user("Call the tool"),
            Message.assistant([{ type: "tool-call", id: "call_1", name: "lookup", input: {} }]),
            Message.tool({ id: "call_1", name: "lookup", result: "Done" }),
          ],
        }),
      )

      expect(prepared.body.messages.at(-1)).toMatchObject({
        role: "tool",
        tool_call_id: "call_1",
        content: [{ type: "text", text: '"Done"', cache_control: { type: "ephemeral" } }],
      })
    }),
  )

  it.effect("sends no default breakpoints to upstreams that cache without them", () =>
    Effect.gen(function* () {
      const openrouter = OpenRouter.configure({ apiKey: "test-key" })
      const bodies = yield* Effect.forEach(["google/gemini-2.5-flash", "openai/gpt-5-mini"], (id) =>
        compileRequest(
          LLM.request({
            model: openrouter.model(id),
            system: "Base agent",
            tools: [{ name: "lookup", description: "Lookup", inputSchema: { type: "object", properties: {} } }],
            prompt: "Hello",
          }),
        ).pipe(Effect.map((prepared) => prepared.body)),
      )

      bodies.forEach((body) => {
        expect(body.tools?.[0]?.cache_control).toBeUndefined()
        expect(JSON.stringify(body)).not.toContain("cache_control")
      })
    }),
  )

  it.effect("lowers the native cache policy to OpenRouter cache controls", () =>
    Effect.gen(function* () {
      const prepared = yield* compileRequest(
        LLM.request({
          model: OpenRouter.configure({ apiKey: "test-key" }).model("anthropic/claude-sonnet-4.6"),
          system: [
            { type: "text", text: "Base agent", cache: new CacheHint({ type: "ephemeral", ttlSeconds: 3_600 }) },
            { type: "text", text: "Project instructions" },
          ],
          tools: [{ name: "lookup", description: "Lookup", inputSchema: { type: "object", properties: {} } }],
          prompt: "Hello",
          cache: { tools: true, system: true, messages: { tail: 1 } },
        }),
      )

      expect(prepared.body).toMatchObject({
        tools: [{ cache_control: { type: "ephemeral" } }],
        system: [
          { text: "Base agent", cache_control: { type: "ephemeral", ttl: "1h" } },
          { text: "Project instructions", cache_control: { type: "ephemeral" } },
        ],
        messages: [
          {
            role: "user",
            content: [{ text: "Hello", cache_control: { type: "ephemeral" } }],
          },
        ],
      })
    }),
  )

  it.effect("lowers manual assistant and tool-result cache hints", () =>
    Effect.gen(function* () {
      const prepared = yield* compileRequest(
        LLM.request({
          model: OpenRouter.configure({ apiKey: "test-key" }).chat("anthropic/claude-sonnet-4.6"),
          cache: "none",
          messages: [
            Message.user("Call the tool"),
            Message.assistant("Unmarked reply"),
            Message.user("Call again"),
            Message.assistant([
              { type: "text", text: "Calling", cache: new CacheHint({ type: "ephemeral" }) },
              { type: "tool-call", id: "call_1", name: "lookup", input: {} },
            ]),
            Message.tool({
              id: "call_1",
              name: "lookup",
              result: "Done",
              cache: new CacheHint({ type: "ephemeral", ttlSeconds: 3_600 }),
            }),
          ],
        }),
      )

      expect(prepared.body.messages).toMatchObject([
        { role: "user", content: "Call the tool" },
        { role: "assistant", content: "Unmarked reply" },
        { role: "user", content: "Call again" },
        {
          role: "assistant",
          content: [{ type: "text", text: "Calling", cache_control: { type: "ephemeral" } }],
          tool_calls: [{ id: "call_1", type: "function", function: { name: "lookup", arguments: "{}" } }],
        },
        {
          role: "tool",
          content: [{ type: "text", text: '"Done"', cache_control: { type: "ephemeral", ttl: "1h" } }],
        },
      ])
    }),
  )

  it.effect("caps manual cache controls at four breakpoints", () =>
    Effect.gen(function* () {
      const cache = new CacheHint({ type: "ephemeral" })
      const prepared = yield* compileRequest(
        LLM.request({
          model: OpenRouter.configure({ apiKey: "test-key" }).model("anthropic/claude-sonnet-4.6"),
          cache: "none",
          system: [1, 2, 3, 4, 5].map((index) => ({ type: "text" as const, text: `System ${index}`, cache })),
          prompt: "Hello",
        }),
      )

      expect(prepared.body.system?.filter((part) => part.cache_control !== undefined)).toHaveLength(4)
    }),
  )

  it.effect("does not emit text cache markers on reasoning-only assistant messages", () =>
    Effect.gen(function* () {
      const prepared = yield* compileRequest(
        LLM.request({
          model: OpenRouter.configure({ apiKey: "test-key" }).chat("anthropic/claude-sonnet-4.6"),
          cache: { messages: "latest-assistant" },
          messages: [Message.user("Think"), Message.assistant([{ type: "reasoning", text: "Reasoning" }])],
        }),
      )

      expect(prepared.body.messages).toMatchObject([
        { role: "user", content: "Think" },
        { role: "assistant", content: "" },
      ])
      expect(prepared.body.messages[1]).not.toHaveProperty("cache_control")
    }),
  )

  it.effect("counts wrapped system-update markers once so all four default breakpoints survive", () =>
    Effect.gen(function* () {
      const prepared = yield* compileRequest(
        LLM.request({
          model: OpenRouter.configure({ apiKey: "test-key" }).chat("anthropic/claude-sonnet-4.6"),
          system: [
            { type: "text", text: "Base agent" },
            { type: "text", text: "Project instructions" },
          ],
          tools: [{ name: "lookup", description: "Lookup", inputSchema: { type: "object", properties: {} } }],
          messages: [Message.user("Start"), Message.system("Updated instructions")],
        }),
      )

      expect(prepared.body.tools?.[0]?.cache_control).toEqual({ type: "ephemeral" })
      expect(prepared.body.messages.at(-1)).toMatchObject({
        role: "user",
        content: [
          { type: "text", text: "Start" },
          {
            type: "text",
            text: "<system-update>\nUpdated instructions\n</system-update>",
            cache_control: { type: "ephemeral" },
          },
        ],
      })
    }),
  )

  it.effect("allows usage accounting to be disabled explicitly", () =>
    Effect.gen(function* () {
      const prepared = yield* compileRequest(
        LLM.request({
          model: OpenRouter.configure({
            apiKey: "test-key",
            providerOptions: { usage: false },
          }).chat("openai/gpt-4o-mini"),
          cache: "none",
          prompt: "Hello",
        }),
      )

      expect(prepared.body.usage).toEqual({ include: false })
    }),
  )

  it.effect("fits the reasoning budget to half the output limit", () =>
    Effect.gen(function* () {
      const reasoning = (maxTokens: number | undefined, value: Record<string, unknown>) =>
        compileRequest(
          LLM.request({
            model: OpenRouter.configure({ apiKey: "test-key" }).model("qwen/qwen3.8-flash"),
            cache: "none",
            prompt: "Hello",
            ...(maxTokens === undefined ? {} : { generation: { maxTokens } }),
            providerOptions: { reasoning: value },
          }),
        ).pipe(Effect.map((prepared) => prepared.body.reasoning))

      expect(yield* reasoning(32_000, { max_tokens: 131_071 })).toEqual({ max_tokens: 16_000 })
      expect(yield* reasoning(131_072, { max_tokens: 65_536 })).toEqual({ max_tokens: 65_536 })
      expect(yield* reasoning(1_500, { max_tokens: 65_536 })).toEqual({ max_tokens: 1_024 })
      expect(yield* reasoning(undefined, { max_tokens: 131_071 })).toEqual({ max_tokens: 131_071 })
      expect(yield* reasoning(32_000, { effort: "high" })).toEqual({ effort: "high" })
    }),
  )

  it.effect("applies OpenRouter payload options from the model helper", () =>
    Effect.gen(function* () {
      const prepared = yield* compileRequest(
        LLM.request({
          model: OpenRouter.configure({
            apiKey: "test-key",
            providerOptions: {
              usage: true,
              reasoning: { effort: "high" },
              models: ["anthropic/claude-sonnet-4.6", "google/gemini-3.1-pro"],
              provider: { order: ["anthropic", "google"], require_parameters: true },
              plugins: [{ id: "response-healing" }],
              web_search_options: { engine: "native", max_results: 3 },
              debug: { echo_upstream_body: true },
              user: "user_123",
              future_option: { enabled: true },
            },
          }).chat("anthropic/claude-3.7-sonnet:thinking"),
          prompt: "Think briefly.",
          promptCacheKey: "session_123",
        }),
      )

      expect(prepared.body).toMatchObject({
        usage: { include: true },
        reasoning: { effort: "high" },
        prompt_cache_key: "session_123",
        models: ["anthropic/claude-sonnet-4.6", "google/gemini-3.1-pro"],
        provider: { order: ["anthropic", "google"], require_parameters: true },
        plugins: [{ id: "response-healing" }],
        web_search_options: { engine: "native", max_results: 3 },
        debug: { echo_upstream_body: true },
        user: "user_123",
        future_option: { enabled: true },
      })
    }),
  )

  it.effect("omits the prompt cache key when caching is disabled", () =>
    Effect.gen(function* () {
      const prepared = yield* compileRequest(
        LLM.request({
          model: OpenRouter.configure({ apiKey: "test-key" }).model("openai/gpt-4o-mini"),
          prompt: "Hello",
          promptCacheKey: "session_123",
          cache: "none",
        }),
      )

      expect(prepared.body).not.toHaveProperty("prompt_cache_key")
    }),
  )

  it.effect("filters invalid known OpenRouter options while preserving extensions", () =>
    Effect.gen(function* () {
      const invalid: Record<string, unknown> = {
        usage: "yes",
        models: "anthropic/claude-sonnet-4.6",
        provider: [],
        plugins: {},
        web_search_options: [],
        debug: [],
        user: 123,
        reasoning: [],
        promptCacheKey: 123,
        future_option: { enabled: true },
      }
      const prepared = yield* compileRequest(
        LLM.request({
          model: OpenRouter.configure({
            apiKey: "test-key",
            providerOptions: invalid,
          }).model("openai/gpt-4o-mini"),
          prompt: "Hello",
        }),
      )

      expect(prepared.body).toMatchObject({ future_option: { enabled: true } })
      expect(prepared.body).not.toHaveProperty("usage")
      expect(prepared.body).not.toHaveProperty("models")
      expect(prepared.body).not.toHaveProperty("provider")
      expect(prepared.body).not.toHaveProperty("plugins")
      expect(prepared.body).not.toHaveProperty("web_search_options")
      expect(prepared.body).not.toHaveProperty("debug")
      expect(prepared.body).not.toHaveProperty("user")
      expect(prepared.body).not.toHaveProperty("reasoning")
      expect(prepared.body).not.toHaveProperty("prompt_cache_key")
    }),
  )

  it.effect("preserves the upstream provider finish reason", () =>
    Effect.gen(function* () {
      const model = OpenRouter.configure({ apiKey: "test-key" }).chat("anthropic/claude-sonnet-4.6")
      const response = yield* LLMClient.generate(LLM.request({ model, prompt: "Say hello." })).pipe(
        Effect.provide(
          fixedResponse(
            sseEvents({
              choices: [{ delta: { content: "Hello" }, finish_reason: "stop", native_finish_reason: "end_turn" }],
            }),
          ),
        ),
      )

      expect(response.finishReason).toEqual({ normalized: "stop", raw: "end_turn" })
    }),
  )

  it.effect("fails on a mid-stream provider error", () =>
    Effect.gen(function* () {
      const model = OpenRouter.configure({ apiKey: "test-key" }).chat("openai/gpt-4o-mini")
      const error = yield* LLMClient.generate(LLM.request({ model, prompt: "Say hello." })).pipe(
        Effect.provide(
          fixedResponse(
            sseEvents({
              error: { code: 502, message: "Provider disconnected" },
            }),
          ),
        ),
        Effect.flip,
      )

      expect(error.reason).toMatchObject({ _tag: "ProviderInternal" })
      expect(error.message).toContain("Provider disconnected")
    }),
  )

  it.effect("preserves manually supplied reasoning details", () =>
    Effect.gen(function* () {
      const details = [
        { type: "reasoning.text", text: "Think", format: "anthropic-claude-v1", index: 0 },
        { type: "reasoning.text", text: "ing", format: "anthropic-claude-v1", index: 0 },
        { type: "reasoning.text", signature: "signed", format: "anthropic-claude-v1", index: 0 },
        { type: "reasoning.encrypted", data: "opaque", format: "openai-responses-v1", index: 1 },
      ]
      const prepared = yield* compileRequest(
        LLM.request({
          model: OpenRouter.configure({ apiKey: "test-key" }).chat("anthropic/claude-sonnet-4.6"),
          cache: "none",
          messages: [
            Message.assistant([
              {
                type: "reasoning",
                text: "Thinking",
                providerMetadata: { openrouter: { reasoningField: "reasoning", reasoningDetails: details } },
              },
            ]),
          ],
        }),
      )

      expect(prepared.body.messages).toEqual([
        {
          role: "assistant",
          content: "",
          reasoning: "Thinking",
          reasoning_content: undefined,
          reasoning_details: details,
          reasoning_text: undefined,
        },
      ])
    }),
  )

  it.effect("drops unrecognized details and preserves duplicate continuation details", () =>
    Effect.gen(function* () {
      const details = [
        { type: "reasoning.encrypted", id: "state", data: "opaque" },
        { type: "reasoning.encrypted", id: "state", data: "opaque" },
      ]
      const prepared = yield* compileRequest(
        LLM.request({
          model: OpenRouter.configure({ apiKey: "test-key" }).chat("anthropic/claude-sonnet-4.6"),
          cache: "none",
          messages: [
            Message.assistant({
              type: "reasoning",
              text: "Thinking",
              providerMetadata: {
                openrouter: {
                  reasoningField: "reasoning",
                  reasoningDetails: [
                    { type: "reasoning.future", format: "provider-v2", state: { opaque: true } },
                    ...details,
                  ],
                },
              },
            }),
          ],
        }),
      )

      expect(prepared.body.messages).toEqual([
        {
          role: "assistant",
          content: "",
          reasoning: "Thinking",
          reasoning_content: undefined,
          reasoning_details: details,
          reasoning_text: undefined,
        },
      ])
    }),
  )

  it.effect("does not merge distinct adjacent reasoning text blocks", () =>
    Effect.gen(function* () {
      const details = [
        { type: "reasoning.text", id: "first", index: 0, text: "A", opaque: "first" },
        { type: "reasoning.text", id: "second", index: 1, text: "B", opaque: "second" },
      ]
      const prepared = yield* compileRequest(
        LLM.request({
          model: OpenRouter.configure({ apiKey: "test-key" }).chat("anthropic/claude-sonnet-4.6"),
          cache: "none",
          messages: [
            Message.assistant({
              type: "reasoning",
              text: "AB",
              providerMetadata: { openrouter: { reasoningField: "reasoning", reasoningDetails: details } },
            }),
          ],
        }),
      )

      expect(prepared.body.messages).toEqual([
        {
          role: "assistant",
          content: "",
          reasoning: "AB",
          reasoning_content: undefined,
          reasoning_details: details,
          reasoning_text: undefined,
        },
      ])
    }),
  )

  it.effect("omits scalar reasoning without continuation details", () =>
    Effect.gen(function* () {
      const prepared = yield* compileRequest(
        LLM.request({
          model: OpenRouter.configure({ apiKey: "test-key" }).chat("anthropic/claude-sonnet-4.6"),
          cache: "none",
          messages: [Message.assistant({ type: "reasoning", text: "Thinking" })],
        }),
      )

      expect(prepared.body.messages).toEqual([
        {
          role: "assistant",
          content: "",
          reasoning: undefined,
          reasoning_content: undefined,
          reasoning_details: undefined,
          reasoning_text: undefined,
        },
      ])
    }),
  )
})
