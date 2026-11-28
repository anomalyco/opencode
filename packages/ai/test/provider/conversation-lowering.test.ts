import { expect } from "bun:test"
import { Effect } from "effect"
import { ai, Message, ToolCallPart, ToolDefinition } from "../../src/effect.js"
import { OpenAI } from "../../src/providers.js"
import { OpenResponses } from "../../src/protocols/open-responses.js"
import { it } from "../lib/effect.js"

it.effect("conversation lowering excludes generation settings and tool definitions", () =>
  Effect.gen(function* () {
    const body = yield* OpenResponses.lowerConversation(
      ai.request({
        model: OpenAI.configure({ apiKey: "test" }).responses("fixture"),
        system: "Keep the context",
        messages: [Message.user("hello"), Message.assistant("hi")],
        maxTokens: 100,
        temperature: 0.5,
        providerOptions: { store: false },
        tools: [{ name: "unsupported", description: "Generation only", inputSchema: {}, native: { unsupported: {} } }],
      }),
      { id: "open-responses", name: "Open Responses" },
    )
    expect(body).toEqual({
      model: "fixture",
      input: [
        { type: "message", role: "developer", content: "Keep the context" },
        { type: "message", role: "user", content: [{ type: "input_text", text: "hello" }] },
        { type: "message", role: "assistant", status: "completed", content: [{ type: "output_text", text: "hi" }] },
      ],
    })
  }),
)

it.effect("truncates replayed names of undeclared tool calls to the provider limit", () =>
  Effect.gen(function* () {
    const madeUp = ToolCallPart.make({
      id: "call_1",
      name: 'tools["websearch-demo-agent"]["websearch-web-search-tool___WebSearch"]',
      input: {},
    })
    const declared = ToolCallPart.make({ id: "call_2", name: "weather", input: { city: "Paris" } })
    const body = yield* OpenResponses.lowerConversation(
      ai.request({
        model: OpenAI.configure({ apiKey: "test" }).responses("fixture"),
        tools: [ToolDefinition.make({ name: "weather", description: "Weather", inputSchema: { type: "object" } })],
        messages: [
          Message.user("Check the weather"),
          Message.assistant([madeUp, declared]),
          Message.tool({ id: madeUp.id, name: madeUp.name, result: "unknown tool", resultType: "error" }),
          Message.tool({ id: declared.id, name: declared.name, result: "sunny", resultType: "text" }),
        ],
      }),
      { id: "open-responses", name: "Open Responses" },
    )

    // Responses routes keep native namespaces, so they never see flattenRequest: the same replay rule applies
    // here, or a made-up name goes to the provider at full length and the session dies (#65822).
    expect(body.input).toEqual([
      { type: "message", role: "user", content: [{ type: "input_text", text: "Check the weather" }] },
      {
        type: "function_call",
        call_id: "call_1",
        name: "tools__websearch-demo-agent____websearch-web-search-tool___WebSe",
        arguments: "{}",
      },
      { type: "function_call", call_id: "call_2", name: "weather", arguments: '{"city":"Paris"}' },
      { type: "function_call_output", call_id: "call_1", output: "unknown tool" },
      { type: "function_call_output", call_id: "call_2", output: "sunny" },
    ])
  }),
)
