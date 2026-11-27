import { expect } from "bun:test"
import { Effect, Schema } from "effect"
import { ai, Message, ToolCallPart } from "../../src/effect.js"
import { OpenAIChat } from "../../src/protocols/openai-chat.js"
import { OpenAIResponses } from "../../src/protocols/openai-responses.js"
import { Auth } from "../../src/route/auth.js"
import { compileRequest } from "../../src/route/client.js"
import { it } from "../lib/effect.js"
import { apiModel } from "../lib/model.js"

for (const api of [OpenAIChat.api, OpenAIResponses.api]) {
  const model = apiModel(api, "gpt-4.1-mini", { baseURL: "https://api.openai.test/v1", auth: Auth.bearer("test") })
  const chat = api.id === "openai-chat"

  it.effect(`${api.id} serializes schema-valid undefined historical tool input as an empty object`, () =>
    Effect.gen(function* () {
      const message = Schema.decodeUnknownSync(Message)({
        role: "assistant",
        content: [{ type: "tool-call", id: "call_1", name: "lookup", input: undefined }],
      })
      expect(Schema.is(Message)(message)).toBe(true)
      const prepared = yield* compileRequest(
        ai.request({
          model,
          messages: [
            Message.user("Look up the value."),
            message,
            Message.tool({ id: "call_1", name: "lookup", result: "Missing input", resultType: "error" }),
          ],
        }),
      )
      if (chat)
        expect(prepared.body.messages).toContainEqual({
          role: "assistant",
          content: null,
          tool_calls: [{ id: "call_1", type: "function", function: { name: "lookup", arguments: "{}" } }],
        })
      if (!chat)
        expect(prepared.body.input).toContainEqual({
          type: "function_call",
          call_id: "call_1",
          name: "lookup",
          arguments: "{}",
        })
      expect(message.content[0]).toEqual({ type: "tool-call", id: "call_1", name: "lookup", input: undefined })
    }),
  )

  it.effect(`${api.id} preserves defined historical tool inputs`, () =>
    Effect.gen(function* () {
      for (const [input, encoded] of [
        [null, "null"],
        [[], "[]"],
        [42, "42"],
        ["invalid", '"invalid"'],
        [{ value: "original" }, '{"value":"original"}'],
      ] as const) {
        const prepared = yield* compileRequest(
          ai.request({
            model,
            messages: [
              Message.assistant([ToolCallPart.make({ id: "call_1", name: "lookup", input })]),
              Message.tool({ id: "call_1", name: "lookup", result: "Invalid input", resultType: "error" }),
            ],
          }),
        )
        if (chat) expect(prepared.body.messages[0].tool_calls[0].function.arguments).toBe(encoded)
        if (!chat) expect(prepared.body.input[0].arguments).toBe(encoded)
      }
    }),
  )
}
