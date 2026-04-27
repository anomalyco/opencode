import { describe, expect } from "bun:test"
import { AnthropicMessages, OpenAICompatibleChat } from "@opencode-ai/llm"
import { client } from "@opencode-ai/llm/adapter"
import { OpenAIResponses } from "@opencode-ai/llm/provider/openai-responses"
import { Cause, Effect, Exit, Layer, Schema } from "effect"
import { ModelID, ProviderID } from "../../src/provider/schema"
import { LLMNative } from "../../src/session/llm-native"
import { MessageID, PartID, SessionID } from "../../src/session/schema"
import { ProviderTest } from "../fake/provider"
import { testEffect } from "../lib/effect"
import type { MessageV2 } from "../../src/session/message-v2"
import type { Provider } from "../../src/provider"
import type { Tool } from "../../src/tool"

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

const filePart = (messageID: MessageID): MessageV2.FilePart => ({
  id: PartID.ascending(),
  sessionID,
  messageID,
  type: "file",
  mime: "image/png",
  url: "data:image/png;base64,abc",
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
    const exit = yield* LLMNative.request({
      provider: ProviderTest.info({ id: ProviderID.openai }, mdl),
      model: mdl,
      messages: [userMessage(mdl, userID, [filePart(userID)])],
    }).pipe(Effect.exit)

    expect(Exit.isFailure(exit)).toBe(true)
    if (Exit.isFailure(exit)) {
      const err = Cause.squash(exit.cause)
      expect(err).toBeInstanceOf(Error)
      if (err instanceof Error) {
        expect(err.message).toBe(`Native LLM request conversion does not support file parts in message ${userID}`)
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
    const prepared = yield* client({ adapters: [OpenAIResponses.adapter] }).prepare(request)

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
    const prepared = yield* client({ adapters: [AnthropicMessages.adapter] }).prepare(request)

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
    const prepared = yield* client({ adapters: [OpenAICompatibleChat.adapter] }).prepare(request)

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
})
