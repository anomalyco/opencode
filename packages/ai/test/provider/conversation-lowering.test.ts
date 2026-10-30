import { expect } from "bun:test"
import { Effect } from "effect"
import { ai, Message, ToolCallPart } from "../../src/effect.js"
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
        generation: { maxTokens: 100, temperature: 0.5 },
        providerOptions: { store: false },
        tools: [{ name: "unsupported", description: "Generation only", inputSchema: {}, native: { unsupported: {} } }],
      }),
      { id: "open-responses", name: "Open Responses" },
    )
    expect(body).toEqual({
      model: "fixture",
      instructions: "Keep the context",
      input: [
        { type: "message", role: "user", content: [{ type: "input_text", text: "hello" }] },
        { type: "message", role: "assistant", status: "completed", content: [{ type: "output_text", text: "hi" }] },
      ],
    })
  }),
)

it.effect("conversation lowering degrades an unencodable json tool result to text", () =>
  Effect.gen(function* () {
    const cases = [
      { result: undefined, output: "undefined" },
      { result: { a: 1 }, output: '{"a":1}' },
      { result: "abc", output: '"abc"' },
    ]

    for (const item of cases) {
      const body = yield* OpenResponses.lowerConversation(
        ai.request({
          model: OpenAI.configure({ apiKey: "test" }).responses("fixture"),
          messages: [
            Message.assistant(ToolCallPart.make({ id: "call_1", name: "lookup", input: {} })),
            Message.tool({ id: "call_1", name: "lookup", result: item.result }),
          ],
        }),
        { id: "open-responses", name: "Open Responses" },
      )

      expect(body.input).toContainEqual({
        type: "function_call_output",
        call_id: "call_1",
        output: item.output,
      })
    }
  }),
)
