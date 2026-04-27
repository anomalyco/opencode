import { describe, expect, test } from "bun:test"
import { client } from "@opencode-ai/llm/adapter"
import { OpenAIResponses } from "@opencode-ai/llm/provider/openai-responses"
import { Effect, Schema } from "effect"
import { ModelID, ProviderID } from "../../src/provider/schema"
import { LLMNative } from "../../src/session/llm-native"
import { MessageID, PartID, SessionID } from "../../src/session/schema"
import { ProviderTest } from "../fake/provider"
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

describe("LLMNative.request", () => {
  test("builds a text-only native LLM request", async () => {
    const mdl = model()
    const provider = ProviderTest.info({ id: ProviderID.openai, key: "openai-key" }, mdl)
    const userID = MessageID.ascending()
    const assistantID = MessageID.ascending()

    const request = await Effect.runPromise(
      LLMNative.request({
        id: "request-1",
        provider,
        model: mdl,
        system: ["You are concise.", ""],
        generation: { maxTokens: 123, temperature: 0.2, topP: 0.9 },
        messages: [
          userMessage(mdl, userID, [textPart(userID, "ignored", { ignored: true }), textPart(userID, "Hello")]),
          assistantMessage(mdl, assistantID, userID, [textPart(assistantID, "Hi")]),
        ],
      }),
    )

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
  })

  test("converts native tool definitions", async () => {
    const mdl = model()
    const request = await Effect.runPromise(
      LLMNative.request({
        provider: ProviderTest.info({ id: ProviderID.openai }, mdl),
        model: mdl,
        messages: [],
        tools: [lookupTool],
      }),
    )

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
  })

  test("converts assistant reasoning and tool history", async () => {
    const mdl = model()
    const provider = ProviderTest.info({ id: ProviderID.openai }, mdl)
    const userID = MessageID.ascending()
    const assistantID = MessageID.ascending()

    const request = await Effect.runPromise(
      LLMNative.request({
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
      }),
    )

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
  })

  test("prepares OpenAI Responses text and tool request body", async () => {
    const mdl = model()
    const userID = MessageID.ascending()
    const assistantID = MessageID.ascending()
    const request = await Effect.runPromise(
      LLMNative.request({
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
      }),
    )
    const prepared = await Effect.runPromise(client({ adapters: [OpenAIResponses.adapter] }).prepare(request))

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
  })
})
