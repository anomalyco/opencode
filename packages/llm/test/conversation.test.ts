import { describe, expect, it } from "bun:test"
import { Conversation, LLM } from "../src"

const model = LLM.model({
  id: "test-model",
  provider: "test-provider",
  protocol: "openai-chat",
})

const request = LLM.request({
  id: "req_1",
  model,
  prompt: "Use the tool.",
})

describe("Conversation", () => {
  it("returns semantic deltas while mutating state", () => {
    const state = Conversation.empty()

    expect(Conversation.mutate(state, { type: "text-delta", text: "Hello" })).toEqual([
      { type: "assistant-content-added", part: { type: "text", text: "Hello" } },
    ])
    expect(Conversation.mutate(state, { type: "text-delta", text: " world" })).toEqual([
      { type: "assistant-content-merged", part: { type: "text", text: "Hello world" } },
    ])
    expect(Conversation.mutate(state, { type: "tool-call", id: "call_1", name: "lookup", input: { query: "x" } })).toMatchObject([
      {
        type: "assistant-content-added",
        part: { type: "tool-call", id: "call_1", name: "lookup", input: { query: "x" } },
      },
      {
        type: "client-tool-call-added",
        call: { type: "tool-call", id: "call_1", name: "lookup", input: { query: "x" } },
      },
    ])
    expect(Conversation.mutate(state, { type: "request-finish", reason: "tool-calls" })).toEqual([
      { type: "finished", reason: "tool-calls" },
    ])
  })

  it("returns provider tool deltas without client dispatch", () => {
    const state = Conversation.empty()

    expect(
      Conversation.mutate(state, {
        type: "tool-call",
        id: "search_1",
        name: "web_search",
        input: { query: "effect" },
        providerExecuted: true,
      }),
    ).toMatchObject([
      {
        type: "assistant-content-added",
        part: { type: "tool-call", id: "search_1", name: "web_search", providerExecuted: true },
      },
    ])
    expect(
      Conversation.mutate(state, {
        type: "tool-result",
        id: "search_1",
        name: "web_search",
        result: { type: "json", value: { results: [] } },
        providerExecuted: true,
        metadata: { provider: "openai" },
      }),
    ).toEqual([
      {
        type: "assistant-content-added",
        part: {
          type: "tool-result",
          id: "search_1",
          name: "web_search",
          result: { type: "json", value: { results: [] } },
          providerExecuted: true,
          metadata: { provider: "openai" },
        },
      },
      {
        type: "provider-tool-result-added",
        result: {
          type: "tool-result",
          id: "search_1",
          name: "web_search",
          result: { type: "json", value: { results: [] } },
          providerExecuted: true,
          metadata: { provider: "openai" },
        },
      },
    ])
    expect(state.clientToolCalls).toEqual([])
  })

  it("folds streamed model events into assistant content and executable tool calls", () => {
    const state = Conversation.fold([
      { type: "text-delta", text: "I'll check" },
      { type: "text-delta", text: " that." },
      { type: "reasoning-delta", text: "Need weather." },
      { type: "tool-call", id: "call_1", name: "get_weather", input: { city: "Paris" } },
      { type: "request-finish", reason: "tool-calls" },
    ])

    expect(state.finishReason).toBe("tool-calls")
    expect(state.assistantContent).toMatchObject([
      { type: "text", text: "I'll check that." },
      { type: "reasoning", text: "Need weather." },
      {
        type: "tool-call",
        id: "call_1",
        name: "get_weather",
        input: { city: "Paris" },
      },
    ])
    expect(state.clientToolCalls).toMatchObject([
      {
        type: "tool-call",
        id: "call_1",
        name: "get_weather",
        input: { city: "Paris" },
      },
    ])
  })

  it("preserves provider-signed parts instead of merging away metadata", () => {
    const state = Conversation.fold([
      { type: "text-delta", text: "A", metadata: { google: { thoughtSignature: "sig_text_1" } } },
      { type: "text-delta", text: "B", metadata: { google: { thoughtSignature: "sig_text_2" } } },
      { type: "reasoning-delta", text: "thinking" },
      { type: "reasoning-delta", text: "", encrypted: "sig_reasoning" },
    ])

    expect(state.assistantContent).toEqual([
      { type: "text", text: "A", metadata: { google: { thoughtSignature: "sig_text_1" } } },
      { type: "text", text: "B", metadata: { google: { thoughtSignature: "sig_text_2" } } },
      { type: "reasoning", text: "thinking", encrypted: "sig_reasoning" },
    ])
  })

  it("does not merge text or reasoning deltas from different stream item IDs", () => {
    const state = Conversation.fold([
      { type: "text-delta", id: "text_1", text: "A" },
      { type: "text-delta", id: "text_2", text: "B" },
      { type: "reasoning-delta", id: "reasoning_1", text: "C" },
      { type: "reasoning-delta", id: "reasoning_2", text: "", encrypted: "sig_reasoning_2" },
    ])

    expect(state.assistantContent).toEqual([
      { type: "text", text: "A" },
      { type: "text", text: "B" },
      { type: "reasoning", text: "C" },
      { type: "reasoning", text: "", encrypted: "sig_reasoning_2" },
    ])
  })

  it("folds provider-executed tool results into assistant content without scheduling dispatch", () => {
    const state = Conversation.fold([
      { type: "tool-call", id: "search_1", name: "web_search", input: { query: "effect" }, providerExecuted: true },
      {
        type: "tool-result",
        id: "search_1",
        name: "web_search",
        result: { type: "json", value: { results: [] } },
        providerExecuted: true,
      },
      { type: "request-finish", reason: "stop" },
    ])

    expect(state.clientToolCalls).toEqual([])
    expect(state.assistantContent).toMatchObject([
      {
        type: "tool-call",
        id: "search_1",
        name: "web_search",
        input: { query: "effect" },
        providerExecuted: true,
      },
      {
        type: "tool-result",
        id: "search_1",
        name: "web_search",
        result: { type: "json", value: { results: [] } },
        providerExecuted: true,
      },
    ])
  })

  it("continues a request by appending assistant content and tool result messages", () => {
    const state = Conversation.fold([
      { type: "text-delta", text: "I'll check." },
      { type: "tool-call", id: "call_1", name: "get_weather", input: { city: "Paris" } },
      { type: "request-finish", reason: "tool-calls" },
    ])
    const next = Conversation.continueRequest({
      request,
      state,
      results: [
        {
          id: "call_1",
          name: "get_weather",
          result: { type: "json", value: { temperature: 22 } },
        },
      ],
    })

    expect(next.messages).toMatchObject([
      LLM.user("Use the tool."),
      LLM.assistant([
        { type: "text", text: "I'll check." },
        {
          type: "tool-call",
          id: "call_1",
          name: "get_weather",
          input: { city: "Paris" },
        },
      ]),
      LLM.toolResultMessage({
        id: "call_1",
        name: "get_weather",
        result: { type: "json", value: { temperature: 22 } },
      }),
    ])
  })
})
