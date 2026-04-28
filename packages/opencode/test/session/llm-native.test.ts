import { describe, expect } from "bun:test"
import { AnthropicMessages, BedrockConverse, Gemini, LLMClient, OpenAICompatibleChat, OpenAIResponses, ProviderPatch } from "@opencode-ai/llm"
import { Cause, Effect, Exit, Layer, Schema } from "effect"
import { ModelID, ProviderID } from "../../src/provider/schema"
import { LLMNative } from "../../src/session/llm-native"
import { MessageID, PartID, SessionID } from "../../src/session/schema"
import { ProviderTest } from "../fake/provider"
import { testEffect } from "../lib/effect"
import type { MessageV2 } from "../../src/session/message-v2"
import type { Provider } from "../../src/provider/provider"
import type { Tool } from "../../src/tool/tool"

const sessionID = SessionID.descending()

const model = (input: Partial<Provider.Model> = {}) =>
  ProviderTest.model({
    id: ModelID.make("gpt-5"),
    providerID: ProviderID.openai,
    api: { id: "gpt-5", url: "https://api.openai.com/v1", npm: "@ai-sdk/openai" },
    ...input,
  })

const textPart = (messageID: MessageID, text: string, input: Partial<MessageV2.TextPart> = {}): MessageV2.TextPart => ({
  id: PartID.ascending(),
  sessionID,
  messageID,
  type: "text",
  text,
  ...input,
})

const filePart = (messageID: MessageID, input: Partial<MessageV2.FilePart> = {}): MessageV2.FilePart => ({
  id: PartID.ascending(),
  sessionID,
  messageID,
  type: "file",
  mime: "image/png",
  url: "data:image/png;base64,abc",
  ...input,
})

const reasoningPart = (messageID: MessageID, text: string): MessageV2.ReasoningPart => ({
  id: PartID.ascending(),
  sessionID,
  messageID,
  type: "reasoning",
  text,
  time: { start: 1 },
})

const toolPart = (
  messageID: MessageID,
  input: Partial<MessageV2.ToolPart> & Pick<MessageV2.ToolPart, "callID" | "tool" | "state">,
): MessageV2.ToolPart => ({
  id: PartID.ascending(),
  sessionID,
  messageID,
  type: "tool",
  callID: input.callID,
  tool: input.tool,
  state: input.state,
  metadata: input.metadata,
})

const userMessage = (mdl: Provider.Model, id: MessageID, parts: MessageV2.Part[]): MessageV2.WithParts => {
  return {
    info: {
      id,
      sessionID,
      role: "user",
      time: { created: 1 },
      agent: "build",
      model: { providerID: mdl.providerID, modelID: mdl.id },
    },
    parts,
  }
}

const assistantMessage = (
  mdl: Provider.Model,
  id: MessageID,
  parentID: MessageID,
  parts: MessageV2.Part[],
): MessageV2.WithParts => {
  return {
    info: {
      id,
      sessionID,
      role: "assistant",
      time: { created: 2 },
      parentID,
      modelID: mdl.id,
      providerID: mdl.providerID,
      mode: "build",
      agent: "build",
      path: { cwd: "/tmp/project", root: "/tmp/project" },
      cost: 0,
      tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    },
    parts,
  }
}

const lookupParameters = Schema.Struct({
  query: Schema.String.annotate({ description: "Search query" }),
})

const lookupTool = {
  id: "lookup",
  description: "Lookup project data",
  parameters: lookupParameters,
  execute: () => Effect.succeed({ title: "", metadata: {}, output: "" }),
} satisfies Tool.Def<typeof lookupParameters>

const it = testEffect(Layer.empty)

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

const cacheControl = (value: unknown) => isRecord(value) ? value.cache_control : undefined

const targetArray = (value: unknown, key: string) => isRecord(value) && Array.isArray(value[key]) ? value[key] : []

describe("LLMNative.request", () => {
  it.effect("builds a text-only native LLM request", () => Effect.gen(function* () {
    const mdl = model()
    const provider = ProviderTest.info({ id: ProviderID.openai, key: "openai-key" }, mdl)
    const userID = MessageID.ascending()
    const assistantID = MessageID.ascending()

    const request = yield* LLMNative.request({
      id: "request-1",
      provider,
      model: mdl,
      system: ["You are concise.", ""],
      generation: { maxTokens: 123, temperature: 0.2, topP: 0.9 },
      messages: [
        userMessage(mdl, userID, [textPart(userID, "ignored", { ignored: true }), textPart(userID, "Hello")]),
        assistantMessage(mdl, assistantID, userID, [textPart(assistantID, "Hi")]),
      ],
    })

    expect(request).toMatchObject({
      id: "request-1",
      model: {
        id: "gpt-5",
        provider: "openai",
        protocol: "openai-responses",
        headers: { authorization: "Bearer openai-key" },
      },
      system: [{ type: "text", text: "You are concise." }],
      generation: { maxTokens: 123, temperature: 0.2, topP: 0.9 },
      tools: [],
    })
    expect(request.messages.map((message) => ({ id: message.id, role: message.role, content: message.content }))).toEqual([
      { id: userID, role: "user", content: [{ type: "text", text: "Hello" }] },
      { id: assistantID, role: "assistant", content: [{ type: "text", text: "Hi" }] },
    ])
  }))

  it.effect("converts native tool definitions", () => Effect.gen(function* () {
    const mdl = model()
    const request = yield* LLMNative.request({
      provider: ProviderTest.info({ id: ProviderID.openai }, mdl),
      model: mdl,
      messages: [],
      tools: [lookupTool],
    })

    expect(request.tools).toHaveLength(1)
    expect(request.tools[0]).toMatchObject({
      name: "lookup",
      description: "Lookup project data",
      inputSchema: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "Search query",
          },
        },
        required: ["query"],
      },
      native: {
        opencodeToolID: "lookup",
      },
    })
  }))

  it.effect("converts assistant reasoning and tool history", () => Effect.gen(function* () {
    const mdl = model()
    const provider = ProviderTest.info({ id: ProviderID.openai }, mdl)
    const userID = MessageID.ascending()
    const assistantID = MessageID.ascending()

    const request = yield* LLMNative.request({
      provider,
      model: mdl,
      messages: [
        userMessage(mdl, userID, [textPart(userID, "Check weather")]),
        assistantMessage(mdl, assistantID, userID, [
          reasoningPart(assistantID, "Need a lookup."),
          toolPart(assistantID, {
            callID: "call_1",
            tool: "lookup",
            state: {
              status: "completed",
              input: { query: "weather" },
              output: "sunny",
              title: "Weather",
              metadata: {},
              time: { start: 1, end: 2 },
            },
          }),
        ]),
      ],
    })

    expect(request.messages.map((message) => ({ role: message.role, content: message.content }))).toEqual([
      { role: "user", content: [{ type: "text", text: "Check weather" }] },
      {
        role: "assistant",
        content: [
          { type: "reasoning", text: "Need a lookup.", metadata: undefined },
          { type: "tool-call", id: "call_1", name: "lookup", input: { query: "weather" }, metadata: undefined },
        ],
      },
      {
        role: "tool",
        content: [
          {
            type: "tool-result",
            id: "call_1",
            name: "lookup",
            result: { type: "text", value: "sunny" },
            metadata: undefined,
          },
        ],
      },
    ])
  }))

  it.effect("converts failed tool results as error tool messages", () => Effect.gen(function* () {
    const mdl = model()
    const userID = MessageID.ascending()
    const assistantID = MessageID.ascending()

    const request = yield* LLMNative.request({
      provider: ProviderTest.info({ id: ProviderID.openai }, mdl),
      model: mdl,
      messages: [
        userMessage(mdl, userID, [textPart(userID, "Check weather")]),
        assistantMessage(mdl, assistantID, userID, [
          toolPart(assistantID, {
            callID: "call_error",
            tool: "lookup",
            state: {
              status: "error",
              input: { query: "weather" },
              error: "Lookup failed",
              time: { start: 1, end: 2 },
            },
          }),
        ]),
      ],
    })

    expect(request.messages.map((message) => ({ role: message.role, content: message.content }))).toEqual([
      { role: "user", content: [{ type: "text", text: "Check weather" }] },
      {
        role: "assistant",
        content: [{ type: "tool-call", id: "call_error", name: "lookup", input: { query: "weather" }, metadata: undefined }],
      },
      {
        role: "tool",
        content: [
          {
            type: "tool-result",
            id: "call_error",
            name: "lookup",
            result: { type: "error", value: "Lookup failed" },
            metadata: undefined,
          },
        ],
      },
    ])
  }))

  it.effect("uses interrupted tool metadata output when present", () => Effect.gen(function* () {
    const mdl = model()
    const userID = MessageID.ascending()
    const assistantID = MessageID.ascending()

    const request = yield* LLMNative.request({
      provider: ProviderTest.info({ id: ProviderID.openai }, mdl),
      model: mdl,
      messages: [
        userMessage(mdl, userID, [textPart(userID, "Read logs")]),
        assistantMessage(mdl, assistantID, userID, [
          toolPart(assistantID, {
            callID: "call_interrupted",
            tool: "read_logs",
            state: {
              status: "error",
              input: { path: "app.log" },
              error: "Tool execution aborted",
              metadata: { interrupted: true, output: "partial log output" },
              time: { start: 1, end: 2 },
            },
          }),
        ]),
      ],
    })

    expect(request.messages.at(-1)?.content).toEqual([
      {
        type: "tool-result",
        id: "call_interrupted",
        name: "read_logs",
        result: { type: "text", value: "partial log output" },
        metadata: undefined,
      },
    ])
  }))

  it.effect("marks pending and running tool states as interrupted error results", () => Effect.gen(function* () {
    const mdl = model()
    const userID = MessageID.ascending()
    const assistantID = MessageID.ascending()

    const request = yield* LLMNative.request({
      provider: ProviderTest.info({ id: ProviderID.openai }, mdl),
      model: mdl,
      messages: [
        userMessage(mdl, userID, [textPart(userID, "Run tools")]),
        assistantMessage(mdl, assistantID, userID, [
          toolPart(assistantID, {
            callID: "call_pending",
            tool: "lookup",
            state: { status: "pending", input: { query: "pending" }, raw: "" },
          }),
          toolPart(assistantID, {
            callID: "call_running",
            tool: "lookup",
            state: { status: "running", input: { query: "running" }, title: "Lookup", time: { start: 1 } },
          }),
        ]),
      ],
    })

    expect(request.messages.map((message) => ({ role: message.role, content: message.content }))).toEqual([
      { role: "user", content: [{ type: "text", text: "Run tools" }] },
      {
        role: "assistant",
        content: [
          { type: "tool-call", id: "call_pending", name: "lookup", input: { query: "pending" }, metadata: undefined },
          { type: "tool-call", id: "call_running", name: "lookup", input: { query: "running" }, metadata: undefined },
        ],
      },
      {
        role: "tool",
        content: [
          {
            type: "tool-result",
            id: "call_pending",
            name: "lookup",
            result: { type: "error", value: "[Tool execution was interrupted]" },
            metadata: undefined,
          },
        ],
      },
      {
        role: "tool",
        content: [
          {
            type: "tool-result",
            id: "call_running",
            name: "lookup",
            result: { type: "error", value: "[Tool execution was interrupted]" },
            metadata: undefined,
          },
        ],
      },
    ])
  }))

  it.effect("uses the compacted-output placeholder for compacted completed tools", () => Effect.gen(function* () {
    const mdl = model()
    const userID = MessageID.ascending()
    const assistantID = MessageID.ascending()

    const request = yield* LLMNative.request({
      provider: ProviderTest.info({ id: ProviderID.openai }, mdl),
      model: mdl,
      messages: [
        userMessage(mdl, userID, [textPart(userID, "Read old output")]),
        assistantMessage(mdl, assistantID, userID, [
          toolPart(assistantID, {
            callID: "call_compacted",
            tool: "lookup",
            state: {
              status: "completed",
              input: { query: "old" },
              output: "old output",
              title: "Lookup",
              metadata: {},
              time: { start: 1, end: 2, compacted: 3 },
            },
          }),
        ]),
      ],
    })

    expect(request.messages.at(-1)?.content).toEqual([
      {
        type: "tool-result",
        id: "call_compacted",
        name: "lookup",
        result: { type: "text", value: "[Old tool result content cleared]" },
        metadata: undefined,
      },
    ])
  }))

  it.effect("keeps provider-executed tool results on assistant messages", () => Effect.gen(function* () {
    const mdl = model()
    const userID = MessageID.ascending()
    const assistantID = MessageID.ascending()
    const request = yield* LLMNative.request({
      provider: ProviderTest.info({ id: ProviderID.openai }, mdl),
      model: mdl,
      messages: [
        userMessage(mdl, userID, [textPart(userID, "Search docs")]),
        assistantMessage(mdl, assistantID, userID, [
          toolPart(assistantID, {
            callID: "ws_1",
            tool: "web_search",
            metadata: { providerExecuted: true, provider: "openai" },
            state: {
              status: "completed",
              input: { query: "effect" },
              output: "found",
              title: "Search",
              metadata: {},
              time: { start: 1, end: 2 },
            },
          }),
        ]),
      ],
    })

    expect(request.messages.map((message) => ({ role: message.role, content: message.content }))).toEqual([
      { role: "user", content: [{ type: "text", text: "Search docs" }] },
      {
        role: "assistant",
        content: [
          {
            type: "tool-call",
            id: "ws_1",
            name: "web_search",
            input: { query: "effect" },
            providerExecuted: true,
            metadata: { provider: "openai" },
          },
          {
            type: "tool-result",
            id: "ws_1",
            name: "web_search",
            result: { type: "text", value: "found" },
            providerExecuted: true,
            metadata: { provider: "openai" },
          },
        ],
      },
    ])
  }))

  it.effect("fails instead of dropping unsupported native parts", () => Effect.gen(function* () {
    const mdl = model()
    const userID = MessageID.ascending()
    // Reasoning parts are valid on assistant messages but not user messages —
    // a clean stand-in for the "static gate rejects unknown shapes" path.
    const exit = yield* LLMNative.request({
      provider: ProviderTest.info({ id: ProviderID.openai }, mdl),
      model: mdl,
      messages: [userMessage(mdl, userID, [reasoningPart(userID, "internal thought")])],
    }).pipe(Effect.exit)

    expect(Exit.isFailure(exit)).toBe(true)
    if (Exit.isFailure(exit)) {
      const err = Cause.squash(exit.cause)
      expect(err).toBeInstanceOf(Error)
      if (err instanceof Error) {
        expect(err.message).toBe(`Native LLM request conversion does not support reasoning parts in message ${userID}`)
      }
    }
  }))

  it.effect("converts user file parts with data: URLs to MediaPart", () => Effect.gen(function* () {
    const mdl = model()
    const userID = MessageID.ascending()
    const request = yield* LLMNative.request({
      provider: ProviderTest.info({ id: ProviderID.openai }, mdl),
      model: mdl,
      messages: [
        userMessage(mdl, userID, [
          textPart(userID, "describe this"),
          filePart(userID, {
            mime: "image/png",
            filename: "screenshot.png",
            url: "data:image/png;base64,iVBORw0KGgo=",
          }),
        ]),
      ],
    })

    expect(request.messages).toHaveLength(1)
    expect(request.messages[0].content).toEqual([
      { type: "text", text: "describe this" },
      { type: "media", mediaType: "image/png", data: "iVBORw0KGgo=", filename: "screenshot.png" },
    ])
  }))

  it.effect("preserves filename and base64 payload for document data URLs", () => Effect.gen(function* () {
    const mdl = model()
    const userID = MessageID.ascending()
    const request = yield* LLMNative.request({
      provider: ProviderTest.info({ id: ProviderID.openai }, mdl),
      model: mdl,
      messages: [
        userMessage(mdl, userID, [
          filePart(userID, {
            mime: "application/pdf",
            filename: "report.pdf",
            url: "data:application/pdf;base64,JVBERi0xLg==",
          }),
        ]),
      ],
    })

    expect(request.messages[0].content).toEqual([
      { type: "media", mediaType: "application/pdf", data: "JVBERi0xLg==", filename: "report.pdf" },
    ])
  }))

  it.effect("rejects file parts whose URL is not a data: URL", () => Effect.gen(function* () {
    const mdl = model()
    const userID = MessageID.ascending()
    const exit = yield* LLMNative.request({
      provider: ProviderTest.info({ id: ProviderID.openai }, mdl),
      model: mdl,
      messages: [
        userMessage(mdl, userID, [
          filePart(userID, { mime: "image/png", url: "https://example.com/img.png" }),
        ]),
      ],
    }).pipe(Effect.exit)

    expect(Exit.isFailure(exit)).toBe(true)
    if (Exit.isFailure(exit)) {
      const err = Cause.squash(exit.cause)
      expect(err).toBeInstanceOf(Error)
      if (err instanceof Error) {
        expect(err.message).toContain("file parts")
        expect(err.message).toContain(userID)
        expect(err.message).toContain("https://example.com/img.png")
      }
    }
  }))

  it.effect("prepares OpenAI Responses text and tool request body", () => Effect.gen(function* () {
    const mdl = model()
    const userID = MessageID.ascending()
    const assistantID = MessageID.ascending()
    const request = yield* LLMNative.request({
      provider: ProviderTest.info({ id: ProviderID.openai }, mdl),
      model: mdl,
      messages: [
        userMessage(mdl, userID, [textPart(userID, "What is the weather?")]),
        assistantMessage(mdl, assistantID, userID, [
          toolPart(assistantID, {
            callID: "call_1",
            tool: "lookup",
            state: {
              status: "completed",
              input: { query: "weather" },
              output: '{"forecast":"sunny"}',
              title: "Weather",
              metadata: {},
              time: { start: 1, end: 2 },
            },
          }),
        ]),
      ],
      tools: [lookupTool],
      toolChoice: "lookup",
    })
    const prepared = yield* LLMClient.make({ adapters: [OpenAIResponses.adapter] }).prepare(request)

    expect(prepared.target).toMatchObject({
      model: "gpt-5",
      input: [
        { role: "user", content: [{ type: "input_text", text: "What is the weather?" }] },
        { type: "function_call", call_id: "call_1", name: "lookup", arguments: '{"query":"weather"}' },
        { type: "function_call_output", call_id: "call_1", output: '{"forecast":"sunny"}' },
      ],
      tools: [
        {
          type: "function",
          name: "lookup",
          description: "Lookup project data",
          parameters: {
            type: "object",
            properties: { query: { type: "string", description: "Search query" } },
            required: ["query"],
          },
        },
      ],
      tool_choice: { type: "function", name: "lookup" },
      stream: true,
    })
  }))

  it.effect("prepares Anthropic Messages text and tool request body", () => Effect.gen(function* () {
    const mdl = model({
      id: ModelID.make("claude-sonnet-4-5"),
      providerID: ProviderID.make("anthropic"),
      api: { id: "claude-sonnet-4-5", url: "https://api.anthropic.com/v1", npm: "@ai-sdk/anthropic" },
    })
    const userID = MessageID.ascending()
    const assistantID = MessageID.ascending()
    const request = yield* LLMNative.request({
      provider: ProviderTest.info({ id: ProviderID.make("anthropic"), key: "anthropic-key" }, mdl),
      model: mdl,
      system: ["You are concise."],
      generation: { maxTokens: 20, temperature: 0 },
      messages: [
        userMessage(mdl, userID, [textPart(userID, "What is the weather?")]),
        assistantMessage(mdl, assistantID, userID, [
          toolPart(assistantID, {
            callID: "call_1",
            tool: "lookup",
            state: {
              status: "completed",
              input: { query: "weather" },
              output: '{"forecast":"sunny"}',
              title: "Weather",
              metadata: {},
              time: { start: 1, end: 2 },
            },
          }),
        ]),
      ],
      tools: [lookupTool],
      toolChoice: "lookup",
    })
    const prepared = yield* LLMClient.make({ adapters: [AnthropicMessages.adapter] }).prepare(request)

    expect(request.model).toMatchObject({
      provider: "anthropic",
      protocol: "anthropic-messages",
      headers: { "x-api-key": "anthropic-key" },
    })
    expect(prepared.target).toMatchObject({
      model: "claude-sonnet-4-5",
      system: [{ type: "text", text: "You are concise." }],
      messages: [
        { role: "user", content: [{ type: "text", text: "What is the weather?" }] },
        { role: "assistant", content: [{ type: "tool_use", id: "call_1", name: "lookup", input: { query: "weather" } }] },
        { role: "user", content: [{ type: "tool_result", tool_use_id: "call_1", content: '{"forecast":"sunny"}' }] },
      ],
      tools: [
        {
          name: "lookup",
          description: "Lookup project data",
          input_schema: {
            type: "object",
            properties: { query: { type: "string", description: "Search query" } },
            required: ["query"],
          },
        },
      ],
      tool_choice: { type: "tool", name: "lookup" },
      stream: true,
      max_tokens: 20,
      temperature: 0,
    })
  }))

  it.effect("prepares OpenAI-compatible Chat text and tool request body", () => Effect.gen(function* () {
    const mdl = model({
      id: ModelID.make("meta-llama/Llama-3.3-70B-Instruct-Turbo"),
      providerID: ProviderID.make("togetherai"),
      api: {
        id: "meta-llama/Llama-3.3-70B-Instruct-Turbo",
        url: "https://api.together.xyz/v1",
        npm: "@ai-sdk/togetherai",
      },
    })
    const userID = MessageID.ascending()
    const assistantID = MessageID.ascending()
    const request = yield* LLMNative.request({
      provider: ProviderTest.info({ id: ProviderID.make("togetherai"), key: "together-key" }, mdl),
      model: mdl,
      generation: { maxTokens: 64, temperature: 0 },
      messages: [
        userMessage(mdl, userID, [textPart(userID, "What is the weather?")]),
        assistantMessage(mdl, assistantID, userID, [
          toolPart(assistantID, {
            callID: "call_1",
            tool: "lookup",
            state: {
              status: "completed",
              input: { query: "weather" },
              output: '{"forecast":"sunny"}',
              title: "Weather",
              metadata: {},
              time: { start: 1, end: 2 },
            },
          }),
        ]),
      ],
      tools: [lookupTool],
      toolChoice: "lookup",
    })
    const prepared = yield* LLMClient.make({ adapters: [OpenAICompatibleChat.adapter] }).prepare(request)

    expect(request.model).toMatchObject({
      provider: "togetherai",
      protocol: "openai-compatible-chat",
      baseURL: "https://api.together.xyz/v1",
      headers: { authorization: "Bearer together-key" },
    })
    expect(prepared.target).toMatchObject({
      model: "meta-llama/Llama-3.3-70B-Instruct-Turbo",
      messages: [
        { role: "user", content: "What is the weather?" },
        {
          role: "assistant",
          content: null,
          tool_calls: [
            {
              id: "call_1",
              type: "function",
              function: { name: "lookup", arguments: '{"query":"weather"}' },
            },
          ],
        },
        { role: "tool", tool_call_id: "call_1", content: '{"forecast":"sunny"}' },
      ],
      tools: [
        {
          type: "function",
          function: {
            name: "lookup",
            description: "Lookup project data",
            parameters: {
              type: "object",
              properties: { query: { type: "string", description: "Search query" } },
              required: ["query"],
            },
          },
        },
      ],
      tool_choice: { type: "function", function: { name: "lookup" } },
      stream: true,
      max_tokens: 64,
      temperature: 0,
    })
  }))

  it.effect("maps Azure native requests to OpenAI Responses by default", () => Effect.gen(function* () {
    const mdl = model({
      id: ModelID.make("gpt-5"),
      providerID: ProviderID.make("azure"),
      api: { id: "gpt-5-deployment", url: "", npm: "@ai-sdk/azure" },
    })
    const userID = MessageID.ascending()
    const request = yield* LLMNative.request({
      provider: ProviderTest.info({
        id: ProviderID.make("azure"),
        key: "azure-key",
        options: { resourceName: "opencode-test", apiVersion: "2025-04-01-preview" },
      }, mdl),
      model: mdl,
      messages: [userMessage(mdl, userID, [textPart(userID, "Hello")])],
    })

    expect(request.model).toMatchObject({
      id: "gpt-5-deployment",
      provider: "azure",
      protocol: "openai-responses",
      baseURL: "https://opencode-test.openai.azure.com/openai/v1",
      headers: { authorization: "Bearer azure-key" },
      native: { queryParams: { "api-version": "2025-04-01-preview" } },
    })
  }))

  it.effect("maps Azure useCompletionUrls native requests to OpenAI Chat", () => Effect.gen(function* () {
    const mdl = model({
      id: ModelID.make("gpt-4.1"),
      providerID: ProviderID.make("azure"),
      api: { id: "gpt-4-1-deployment", url: "", npm: "@ai-sdk/azure" },
      options: { useCompletionUrls: true },
    })
    const userID = MessageID.ascending()
    const request = yield* LLMNative.request({
      provider: ProviderTest.info({ id: ProviderID.make("azure"), key: "azure-key", options: { resourceName: "opencode-test" } }, mdl),
      model: mdl,
      messages: [userMessage(mdl, userID, [textPart(userID, "Hello")])],
    })

    expect(request.model).toMatchObject({
      id: "gpt-4-1-deployment",
      provider: "azure",
      protocol: "openai-chat",
      baseURL: "https://opencode-test.openai.azure.com/openai/v1",
      headers: { authorization: "Bearer azure-key" },
      native: { queryParams: { "api-version": "v1" } },
    })
  }))

  it.effect("prepares Gemini text and tool request body", () => Effect.gen(function* () {
    const mdl = model({
      id: ModelID.make("gemini-2.5-flash"),
      providerID: ProviderID.make("google"),
      api: { id: "gemini-2.5-flash", url: "https://generativelanguage.googleapis.com/v1beta", npm: "@ai-sdk/google" },
    })
    const userID = MessageID.ascending()
    const assistantID = MessageID.ascending()
    const request = yield* LLMNative.request({
      provider: ProviderTest.info({ id: ProviderID.make("google"), key: "google-key" }, mdl),
      model: mdl,
      system: ["You are concise."],
      generation: { maxTokens: 32, temperature: 0 },
      messages: [
        userMessage(mdl, userID, [textPart(userID, "What is the weather?")]),
        assistantMessage(mdl, assistantID, userID, [
          toolPart(assistantID, {
            callID: "call_1",
            tool: "lookup",
            state: {
              status: "completed",
              input: { query: "weather" },
              output: '{"forecast":"sunny"}',
              title: "Weather",
              metadata: {},
              time: { start: 1, end: 2 },
            },
          }),
        ]),
      ],
      tools: [lookupTool],
      toolChoice: "lookup",
    })
    const prepared = yield* LLMClient.make({ adapters: [Gemini.adapter] }).prepare(request)

    expect(request.model).toMatchObject({
      provider: "google",
      protocol: "gemini",
      baseURL: "https://generativelanguage.googleapis.com/v1beta",
      headers: { "x-goog-api-key": "google-key" },
    })
    expect(prepared.target).toMatchObject({
      systemInstruction: { parts: [{ text: "You are concise." }] },
      contents: [
        { role: "user", parts: [{ text: "What is the weather?" }] },
        { role: "model", parts: [{ functionCall: { name: "lookup", args: { query: "weather" } } }] },
        {
          role: "user",
          parts: [{ functionResponse: { name: "lookup", response: { name: "lookup", content: '{"forecast":"sunny"}' } } }],
        },
      ],
      tools: [
        {
          functionDeclarations: [
            {
              name: "lookup",
              description: "Lookup project data",
              parameters: {
                type: "object",
                properties: { query: { type: "string", description: "Search query" } },
                required: ["query"],
              },
            },
          ],
        },
      ],
      toolConfig: { functionCallingConfig: { mode: "ANY", allowedFunctionNames: ["lookup"] } },
      generationConfig: { maxOutputTokens: 32, temperature: 0 },
    })
  }))

  // Cache hint policy. The bridge produces a hint-free `LLMRequest`; the
  // `ProviderPatch.cachePromptHints` patch (loaded in `ProviderPatch.defaults`)
  // marks first-2 system parts and last-2 messages with ephemeral cache
  // hints when the model advertises `capabilities.cache.prompt`. Adapters
  // then lower the hints to the provider-specific marker — `cache_control`
  // on Anthropic, `cachePoint` on Bedrock. Non-cache adapters never see a
  // hint thanks to the predicate gate.

  const anthropicModel = () =>
    model({
      id: ModelID.make("claude-sonnet-4-5"),
      providerID: ProviderID.make("anthropic"),
      api: { id: "claude-sonnet-4-5", url: "https://api.anthropic.com/v1", npm: "@ai-sdk/anthropic" },
    })

  const bedrockModel = () =>
    model({
      id: ModelID.make("us.amazon.nova-micro-v1:0"),
      providerID: ProviderID.make("amazon-bedrock"),
      api: {
        id: "us.amazon.nova-micro-v1:0",
        url: "https://bedrock-runtime.us-east-1.amazonaws.com",
        npm: "@ai-sdk/amazon-bedrock",
      },
    })

  it.effect("lowers cache hints to Anthropic cache_control on the first 2 system blocks", () =>
    Effect.gen(function* () {
      const mdl = anthropicModel()
      const userID = MessageID.ascending()
      const request = yield* LLMNative.request({
        provider: ProviderTest.info({ id: ProviderID.make("anthropic"), key: "anthropic-key" }, mdl),
        model: mdl,
        system: ["First", "Second", "Third"],
        messages: [userMessage(mdl, userID, [textPart(userID, "hello")])],
      })
      const prepared = yield* LLMClient.make({
        adapters: [AnthropicMessages.adapter],
        patches: ProviderPatch.defaults,
      }).prepare(request)

      expect(prepared.target).toMatchObject({
        system: [
          { type: "text", text: "First", cache_control: { type: "ephemeral" } },
          { type: "text", text: "Second", cache_control: { type: "ephemeral" } },
          { type: "text", text: "Third" },
        ],
      })
      // The third system block must not carry a cache_control marker.
      expect(cacheControl(targetArray(prepared.target, "system")[2])).toBeUndefined()
    }))

  it.effect("lowers cache hints to Anthropic cache_control on the last text block of the last 2 messages", () =>
    Effect.gen(function* () {
      const mdl = anthropicModel()
      const messageIds = [MessageID.ascending(), MessageID.ascending(), MessageID.ascending()]
      const request = yield* LLMNative.request({
        provider: ProviderTest.info({ id: ProviderID.make("anthropic"), key: "anthropic-key" }, mdl),
        model: mdl,
        messages: messageIds.map((id, index) => userMessage(mdl, id, [textPart(id, `m${index}`)])),
      })
      const prepared = yield* LLMClient.make({
        adapters: [AnthropicMessages.adapter],
        patches: ProviderPatch.defaults,
      }).prepare(request)

      expect(prepared.target).toMatchObject({
        messages: [
          { role: "user", content: [{ type: "text", text: "m0" }] },
          { role: "user", content: [{ type: "text", text: "m1", cache_control: { type: "ephemeral" } }] },
          { role: "user", content: [{ type: "text", text: "m2", cache_control: { type: "ephemeral" } }] },
        ],
      })
      // The first message's text must not carry cache_control.
      const firstMessage = targetArray(prepared.target, "messages")[0]
      expect(cacheControl(targetArray(firstMessage, "content")[0])).toBeUndefined()
    }))

  it.effect("lowers cache hints to Bedrock Converse cachePoint marker blocks end-to-end", () =>
    Effect.gen(function* () {
      const mdl = bedrockModel()
      const userID = MessageID.ascending()
      const request = yield* LLMNative.request({
        provider: ProviderTest.info({ id: ProviderID.make("amazon-bedrock"), key: "bedrock-bearer" }, mdl),
        model: mdl,
        system: ["You are concise."],
        messages: [userMessage(mdl, userID, [textPart(userID, "hello")])],
      })
      const prepared = yield* LLMClient.make({
        adapters: [BedrockConverse.adapter],
        patches: ProviderPatch.defaults,
      }).prepare(request)

      expect(prepared.target).toMatchObject({
        system: [{ text: "You are concise." }, { cachePoint: { type: "default" } }],
        messages: [
          {
            role: "user",
            content: [{ text: "hello" }, { cachePoint: { type: "default" } }],
          },
        ],
      })
    }))

  it.effect("does not apply cache hints when the model does not support prompt caching", () =>
    Effect.gen(function* () {
      // gpt-5 / openai resolves to openai-responses with cache.prompt: false.
      // The patch's `when` predicate must skip, leaving the target hint-free.
      const mdl = model()
      const ids = [MessageID.ascending(), MessageID.ascending()]
      const request = yield* LLMNative.request({
        provider: ProviderTest.info({ id: ProviderID.openai, key: "openai-key" }, mdl),
        model: mdl,
        system: ["A", "B", "C"],
        messages: ids.map((id, index) => userMessage(mdl, id, [textPart(id, `m${index}`)])),
      })
      const prepared = yield* LLMClient.make({
        adapters: [OpenAIResponses.adapter],
        patches: ProviderPatch.defaults,
      }).prepare(request)

      // The serialized OpenAI Responses payload has no cache concept; the
      // assertion is that nothing in the target carries a cache marker.
      const json = JSON.stringify(prepared.target)
      expect(json).not.toContain("cache_control")
      expect(json).not.toContain("cachePoint")
      expect(json).not.toContain("ephemeral")
    }))

  // Encrypted reasoning round-trip. OpenCode persists the encrypted blob in
  // `MessageV2.ReasoningPart.metadata` using the AI-SDK's provider-keyed
  // shape (`metadata.anthropic.signature`,
  // `metadata.openai.reasoningEncryptedContent`) for sessions started on the
  // AI-SDK path. Future LLM-native sessions will store it as a top-level
  // `metadata.encrypted` string. The bridge probes both conventions and
  // populates `LLM.ReasoningPart.encrypted` so adapters can lower it to the
  // wire (Anthropic `thinking.signature`, Bedrock `reasoningText.signature`).

  const reasoningPartWithMetadata = (
    messageID: MessageID,
    text: string,
    metadata: Record<string, unknown>,
  ): MessageV2.ReasoningPart => ({
    id: PartID.ascending(),
    sessionID,
    messageID,
    type: "reasoning",
    text,
    metadata,
    time: { start: 1 },
  })

  it.effect("extracts AI-SDK Anthropic signature into LLM.ReasoningPart.encrypted", () =>
    Effect.gen(function* () {
      const mdl = anthropicModel()
      const userID = MessageID.ascending()
      const assistantID = MessageID.ascending()
      const request = yield* LLMNative.request({
        provider: ProviderTest.info({ id: ProviderID.make("anthropic"), key: "anthropic-key" }, mdl),
        model: mdl,
        messages: [
          userMessage(mdl, userID, [textPart(userID, "think about it")]),
          assistantMessage(mdl, assistantID, userID, [
            reasoningPartWithMetadata(assistantID, "thinking...", {
              anthropic: { signature: "ant-signature-abc" },
            }),
          ]),
        ],
      })

      // The bridge surfaces `encrypted` on the LLM IR's ReasoningPart.
      expect(request.messages[1].content[0]).toMatchObject({
        type: "reasoning",
        text: "thinking...",
        encrypted: "ant-signature-abc",
      })
    }))

  it.effect("lowers encrypted reasoning to Anthropic thinking.signature end-to-end", () =>
    Effect.gen(function* () {
      const mdl = anthropicModel()
      const userID = MessageID.ascending()
      const assistantID = MessageID.ascending()
      const request = yield* LLMNative.request({
        provider: ProviderTest.info({ id: ProviderID.make("anthropic"), key: "anthropic-key" }, mdl),
        model: mdl,
        messages: [
          userMessage(mdl, userID, [textPart(userID, "think about it")]),
          assistantMessage(mdl, assistantID, userID, [
            reasoningPartWithMetadata(assistantID, "thinking...", {
              anthropic: { signature: "ant-signature-abc" },
            }),
          ]),
        ],
      })
      const prepared = yield* LLMClient.make({
        adapters: [AnthropicMessages.adapter],
        patches: ProviderPatch.defaults,
      }).prepare(request)

      expect(prepared.target).toMatchObject({
        messages: [
          { role: "user" },
          {
            role: "assistant",
            content: [{ type: "thinking", thinking: "thinking...", signature: "ant-signature-abc" }],
          },
        ],
      })
    }))

  it.effect("extracts AI-SDK OpenAI reasoningEncryptedContent into LLM.ReasoningPart.encrypted", () =>
    Effect.gen(function* () {
      const mdl = anthropicModel() // any cache-irrelevant cache-capable model works for the bridge check
      const userID = MessageID.ascending()
      const assistantID = MessageID.ascending()
      const request = yield* LLMNative.request({
        provider: ProviderTest.info({ id: ProviderID.make("anthropic"), key: "anthropic-key" }, mdl),
        model: mdl,
        messages: [
          userMessage(mdl, userID, [textPart(userID, "think")]),
          assistantMessage(mdl, assistantID, userID, [
            reasoningPartWithMetadata(assistantID, "internal", {
              openai: { reasoningEncryptedContent: "openai-blob-xyz" },
            }),
          ]),
        ],
      })

      expect(request.messages[1].content[0]).toMatchObject({
        type: "reasoning",
        encrypted: "openai-blob-xyz",
      })
    }))

  it.effect("extracts a top-level metadata.encrypted string", () =>
    Effect.gen(function* () {
      const mdl = anthropicModel()
      const userID = MessageID.ascending()
      const assistantID = MessageID.ascending()
      const request = yield* LLMNative.request({
        provider: ProviderTest.info({ id: ProviderID.make("anthropic"), key: "anthropic-key" }, mdl),
        model: mdl,
        messages: [
          userMessage(mdl, userID, [textPart(userID, "think")]),
          assistantMessage(mdl, assistantID, userID, [
            reasoningPartWithMetadata(assistantID, "internal", { encrypted: "native-blob" }),
          ]),
        ],
      })

      expect(request.messages[1].content[0]).toMatchObject({
        type: "reasoning",
        encrypted: "native-blob",
      })
    }))

  it.effect("leaves encrypted unset when reasoning metadata carries no known key", () =>
    Effect.gen(function* () {
      const mdl = anthropicModel()
      const userID = MessageID.ascending()
      const assistantID = MessageID.ascending()
      const request = yield* LLMNative.request({
        provider: ProviderTest.info({ id: ProviderID.make("anthropic"), key: "anthropic-key" }, mdl),
        model: mdl,
        messages: [
          userMessage(mdl, userID, [textPart(userID, "think")]),
          assistantMessage(mdl, assistantID, userID, [
            reasoningPartWithMetadata(assistantID, "internal", { somethingElse: "x" }),
          ]),
        ],
      })

      const reasoning = request.messages[1].content[0]
      expect(reasoning).toMatchObject({ type: "reasoning", text: "internal" })
      if (reasoning.type === "reasoning") expect(reasoning.encrypted).toBeUndefined()
    }))
})
