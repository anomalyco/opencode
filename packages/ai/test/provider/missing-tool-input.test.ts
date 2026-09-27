import { expect } from "bun:test"
import { Effect, Schema } from "effect"
import { LLM, Message, ToolCallPart } from "../../src/index.js"
import { OpenAIChat } from "../../src/protocols/openai-chat.js"
import { OpenAIResponses } from "../../src/protocols/openai-responses.js"
import { Auth } from "../../src/route/auth.js"
import { compileRequest } from "../../src/route/client.js"
import { it } from "../lib/effect.js"

for (const route of [OpenAIChat.route, OpenAIResponses.route]) {
  const model = route
    .with({ endpoint: { baseURL: "https://api.openai.test/v1" }, auth: Auth.bearer("test") })
    .model({ id: "gpt-4.1-mini" })
  const chat = route.id === "openai-chat"

  it.effect(`${route.id} serializes schema-valid undefined historical tool input as an empty object`, () =>
    Effect.gen(function* () {
      const message = Schema.decodeUnknownSync(Message)({
        role: "assistant",
        content: [{ type: "tool-call", id: "call_1", name: "lookup", input: undefined }],
      })
      expect(Schema.is(Message)(message)).toBe(true)
      const prepared = yield* compileRequest(
        LLM.request({
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

  it.effect(`${route.id} preserves defined historical tool inputs`, () =>
    Effect.gen(function* () {
      for (const [input, encoded] of [
        [null, "null"],
        [[], "[]"],
        [42, "42"],
        ["invalid", '"invalid"'],
        [{ value: "original" }, '{"value":"original"}'],
      ] as const) {
        const prepared = yield* compileRequest(
          LLM.request({
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
