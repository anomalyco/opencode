import { describe, expect, test } from "bun:test"
import { ToolFailure } from "@opencode-ai/llm"
import { LLMClient, RequestExecutor } from "@opencode-ai/llm/route"
import { jsonSchema, tool, type ModelMessage } from "ai"
import { Effect } from "effect"
import { LLMNative } from "@/session/llm/native-request"
import { LLMNativeRuntime } from "@/session/llm/native-runtime"
import type { Provider } from "@/provider/provider"
import { ModelID, ProviderID } from "@/provider/schema"

const baseModel: Provider.Model = {
  id: ModelID.make("gpt-5-mini"),
  providerID: ProviderID.make("openai"),
  api: {
    id: "gpt-5-mini",
    url: "https://api.openai.com/v1",
    npm: "@ai-sdk/openai",
  },
  name: "GPT-5 Mini",
  capabilities: {
    temperature: true,
    reasoning: true,
    attachment: true,
    toolcall: true,
    input: {
      text: true,
      audio: false,
      image: true,
      video: false,
      pdf: false,
    },
    output: {
      text: true,
      audio: false,
      image: false,
      video: false,
      pdf: false,
    },
    interleaved: false,
  },
  cost: {
    input: 0,
    output: 0,
    cache: {
      read: 0,
      write: 0,
    },
  },
  limit: {
    context: 128_000,
    input: 128_000,
    output: 32_000,
  },
  status: "active",
  options: {},
  headers: {
    "x-model": "model-header",
  },
  release_date: "2026-01-01",
}

const providerInfo: Provider.Info = {
  id: ProviderID.make("openai"),
  name: "OpenAI",
  source: "config",
  env: ["OPENAI_API_KEY"],
  options: { apiKey: "test-openai-key" },
  models: {},
}

describe("session.llm-native.request", () => {
  test("maps normalized stream inputs to a native LLM request", () => {
    const messages: ModelMessage[] = [
      {
        role: "system",
        content: "system from messages",
      },
      {
        role: "user",
        content: [
          { type: "text", text: "hello", providerOptions: { openai: { cacheControl: { type: "ephemeral" } } } },
          { type: "file", mediaType: "image/png", filename: "img.png", data: "data:image/png;base64,Zm9v" },
        ],
      },
      {
        role: "assistant",
        content: [
          { type: "reasoning", text: "thinking", providerOptions: { openai: { encryptedContent: "secret" } } },
          { type: "text", text: "I'll run it" },
          {
            type: "tool-call",
            toolCallId: "call-1",
            toolName: "bash",
            input: { command: "ls" },
            providerOptions: { openai: { itemId: "item-1" } },
          },
        ],
      },
      {
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolCallId: "call-1",
            toolName: "bash",
            output: { type: "text", value: "ok" },
            providerOptions: { openai: { outputId: "output-1" } },
          },
        ],
      },
    ]

    const request = LLMNative.request({
      model: baseModel,
      system: ["agent system"],
      messages,
      tools: {
        bash: tool({
          description: "Run a shell command",
          inputSchema: jsonSchema({
            type: "object",
            properties: {
              command: { type: "string" },
            },
            required: ["command"],
          }),
        }),
      },
      toolChoice: "required",
      temperature: 0.2,
      topP: 0.9,
      topK: 40,
      maxOutputTokens: 1024,
      providerOptions: { openai: { store: false } },
      headers: { "x-request": "request-header" },
    })

    expect(request.model).toMatchObject({
      id: "gpt-5-mini",
      provider: "openai",
      route: "openai-responses",
      baseURL: "https://api.openai.com/v1",
      headers: {
        "x-model": "model-header",
        "x-request": "request-header",
      },
      limits: {
        context: 128_000,
        output: 32_000,
      },
    })
    expect(request.system).toEqual([
      { type: "text", text: "agent system" },
      { type: "text", text: "system from messages" },
    ])
    expect(request.generation).toMatchObject({
      temperature: 0.2,
      topP: 0.9,
      topK: 40,
      maxTokens: 1024,
    })
    expect(request.providerOptions).toEqual({ openai: { store: false } })
    expect(request.toolChoice).toMatchObject({ type: "required" })
    expect(request.tools).toMatchObject([
      {
        name: "bash",
        description: "Run a shell command",
        inputSchema: {
          type: "object",
          properties: {
            command: { type: "string" },
          },
          required: ["command"],
        },
      },
    ])
    expect(request.messages).toMatchObject([
      {
        role: "user",
        content: [
          { type: "text", text: "hello", providerMetadata: { openai: { cacheControl: { type: "ephemeral" } } } },
          { type: "media", mediaType: "image/png", filename: "img.png", data: "data:image/png;base64,Zm9v" },
        ],
      },
      {
        role: "assistant",
        content: [
          { type: "reasoning", text: "thinking", providerMetadata: { openai: { encryptedContent: "secret" } } },
          { type: "text", text: "I'll run it" },
          {
            type: "tool-call",
            id: "call-1",
            name: "bash",
            input: { command: "ls" },
            providerMetadata: { openai: { itemId: "item-1" } },
          },
        ],
      },
      {
        role: "tool",
        content: [
          {
            type: "tool-result",
            id: "call-1",
            name: "bash",
            result: { type: "text", value: "ok" },
            providerMetadata: { openai: { outputId: "output-1" } },
          },
        ],
      },
    ])
  })

  test("selects native routes from existing provider packages", () => {
    expect(
      LLMNative.model({ ...baseModel, api: { ...baseModel.api, url: "", npm: "@ai-sdk/anthropic" } }),
    ).toMatchObject({
      route: "anthropic-messages",
      baseURL: "https://api.anthropic.com/v1",
    })
    expect(LLMNative.model({ ...baseModel, api: { ...baseModel.api, url: "", npm: "@ai-sdk/google" } })).toMatchObject({
      route: "gemini",
      baseURL: "https://generativelanguage.googleapis.com/v1beta",
    })
    expect(
      LLMNative.model({ ...baseModel, api: { ...baseModel.api, npm: "@ai-sdk/openai-compatible" } }),
    ).toMatchObject({
      route: "openai-compatible-chat",
      baseURL: "https://api.openai.com/v1",
    })
    expect(
      LLMNative.model({ ...baseModel, api: { ...baseModel.api, url: "", npm: "@openrouter/ai-sdk-provider" } }),
    ).toMatchObject({
      route: "openrouter",
      baseURL: "https://openrouter.ai/api/v1",
    })
  })

  test("fails fast for unsupported provider packages", () => {
    expect(() =>
      LLMNative.request({
        model: { ...baseModel, api: { ...baseModel.api, npm: "unknown-provider" } },
        messages: [],
      }),
    ).toThrow("Native LLM request adapter does not support provider package unknown-provider")
  })

  test("only enables native runtime for supported OpenAI API-key models", () => {
    expect(LLMNativeRuntime.status({ model: baseModel, provider: providerInfo, auth: undefined })).toMatchObject({
      type: "supported",
      apiKey: "test-openai-key",
    })
    expect(
      LLMNativeRuntime.status({
        model: { ...baseModel, providerID: ProviderID.make("opencode") },
        provider: { ...providerInfo, id: ProviderID.make("opencode") },
        auth: undefined,
      }),
    ).toMatchObject({
      type: "supported",
      apiKey: "test-openai-key",
    })
    expect(
      LLMNativeRuntime.status({
        model: { ...baseModel, providerID: ProviderID.make("anthropic") },
        provider: { ...providerInfo, id: ProviderID.make("anthropic") },
        auth: undefined,
      }),
    ).toEqual({ type: "unsupported", reason: "provider is not openai or opencode" })
    expect(
      LLMNativeRuntime.status({
        model: baseModel,
        provider: providerInfo,
        auth: { type: "oauth", refresh: "refresh", access: "access", expires: 1 },
      }),
    ).toEqual({ type: "unsupported", reason: "OAuth auth is not supported" })

    expect(
      LLMNativeRuntime.status({
        model: { ...baseModel, api: { ...baseModel.api, npm: "@ai-sdk/anthropic" } },
        provider: providerInfo,
        auth: undefined,
      }),
    ).toEqual({ type: "unsupported", reason: "provider package is not OpenAI" })

    expect(
      LLMNativeRuntime.status({
        model: baseModel,
        provider: { ...providerInfo, options: {} },
        auth: undefined,
      }),
    ).toEqual({ type: "unsupported", reason: "OpenAI API key is not configured" })
  })

  test("native tool wrapper converts thrown errors into typed ToolFailure", async () => {
    const wrapped = LLMNativeRuntime.nativeTools(
      {
        explode: {
          description: "always throws",
          inputSchema: jsonSchema({ type: "object" }),
          execute: async () => {
            throw new Error("boom")
          },
        } as any,
      },
      { messages: [] as ModelMessage[], abort: new AbortController().signal },
    )

    const failure = await Effect.runPromise(
      Effect.flip(wrapped.explode!.execute!({}, { id: "call-1", name: "explode" })),
    )
    expect(failure).toBeInstanceOf(ToolFailure)
    expect((failure as ToolFailure).message).toBe("boom")
  })

  test("native tool wrapper raises ToolFailure when the source tool has no execute handler", async () => {
    // The AI SDK Tool shape allows execute to be omitted (e.g., client-side / MCP tools).
    // The native runtime owns execution, so encountering such a tool here means upstream
    // wiring is wrong; we want a typed failure, not a silent skip or unhandled exception.
    const wrapped = LLMNativeRuntime.nativeTools(
      { incomplete: { description: "no execute", inputSchema: jsonSchema({ type: "object" }) } as any },
      { messages: [] as ModelMessage[], abort: new AbortController().signal },
    )

    const failure = await Effect.runPromise(
      Effect.flip(wrapped.incomplete!.execute!({}, { id: "call-1", name: "incomplete" })),
    )
    expect(failure).toBeInstanceOf(ToolFailure)
    expect((failure as ToolFailure).message).toContain("incomplete")
  })

  test("compiles through the native OpenAI Responses route", async () => {
    const prepared = await Effect.runPromise(
      LLMClient.prepare(
        LLMNative.request({
          model: baseModel,
          messages: [{ role: "user", content: "hello" }],
          providerOptions: { openai: { store: false } },
          maxOutputTokens: 512,
          headers: { "x-request": "request-header" },
        }),
      ).pipe(Effect.provide(LLMClient.layer), Effect.provide(RequestExecutor.defaultLayer)),
    )

    expect(prepared).toMatchObject({
      route: "openai-responses",
      protocol: "openai-responses",
      body: {
        model: "gpt-5-mini",
        input: [{ role: "user", content: [{ type: "input_text", text: "hello" }] }],
        max_output_tokens: 512,
        store: false,
        stream: true,
      },
    })
  })
})
