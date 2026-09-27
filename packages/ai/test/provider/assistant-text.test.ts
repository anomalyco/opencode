import { expect } from "bun:test"
import { Effect } from "effect"
import { CacheHint, LLM, Message, ToolCallPart } from "../../src/index.js"
import { AnthropicMessages } from "../../src/protocols/anthropic-messages.js"
import { BedrockConverse } from "../../src/protocols/bedrock-converse.js"
import { compileRequest } from "../../src/route/client.js"
import { Auth } from "../../src/route/auth.js"
import { it } from "../lib/effect.js"

const bedrockRoute = BedrockConverse.route.with({
  endpoint: { baseURL: "https://bedrock.test" },
  auth: Auth.bearer("test"),
})

for (const route of [AnthropicMessages.route, bedrockRoute]) {
  const bedrock = route.id === "bedrock-converse"
  const model = route.model({
    id: bedrock ? "global.anthropic.claude-haiku-4-5-20251001-v1:0" : "claude-haiku-4-5-20251001",
  })
  const text = (value: string) => (bedrock ? { text: value } : { type: "text", text: value })
  const cache = new CacheHint({ type: "ephemeral" })

  it.effect(`${route.id} trims only the effective assistant prefill suffix`, () =>
    Effect.gen(function* () {
      const messages = [
        Message.user("Keep the formatting.  "),
        Message.assistant("Historical text. \n"),
        Message.user("Continue."),
        Message.assistant([
          { type: "text", text: "  Leading and middle " },
          { type: "text", text: "spacing \n" },
          { type: "text", text: " \n", cache },
          { type: "text", text: "", cache },
        ]),
        Message.assistant(""),
        Message.assistant([]),
      ]
      const before = structuredClone(messages)
      const request = LLM.request({ model, messages, cache: "none" })
      const prepared = yield* compileRequest(request)
      expect(prepared.body.messages).toEqual([
        { role: "user", content: [text("Keep the formatting.  ")] },
        { role: "assistant", content: [text("Historical text. \n")] },
        { role: "user", content: [text("Continue.")] },
        { role: "assistant", content: [text("  Leading and middle "), text("spacing")] },
      ])
      expect((yield* compileRequest(request)).body).toEqual(prepared.body)
      expect(structuredClone(messages)).toEqual(before)
    }),
  )

  it.effect(`${route.id} preserves a surviving prefill cache marker`, () =>
    Effect.gen(function* () {
      const prepared = yield* compileRequest(
        LLM.request({
          model,
          messages: [Message.user("Continue."), Message.assistant([{ type: "text", text: "  Answer \t", cache }])],
          cache: "none",
        }),
      )
      expect(prepared.body.messages).toEqual([
        { role: "user", content: [text("Continue.")] },
        {
          role: "assistant",
          content: bedrock
            ? [text("  Answer"), { cachePoint: { type: "default" } }]
            : [{ type: "text", text: "  Answer", cache_control: { type: "ephemeral" } }],
        },
      ])
    }),
  )

  it.effect(`${route.id} drops blank-only terminal assistants and their cache markers`, () =>
    Effect.gen(function* () {
      const prepared = yield* compileRequest(
        LLM.request({
          model,
          messages: [
            Message.user("Continue.  "),
            Message.assistant("Prefix \n"),
            Message.assistant([{ type: "text", text: " \n\t", cache }]),
          ],
          cache: "none",
        }),
      )
      expect(prepared.body.messages).toEqual([
        { role: "user", content: [text("Continue.  ")] },
        { role: "assistant", content: [text("Prefix")] },
      ])
    }),
  )

  it.effect(`${route.id} preserves signed reasoning and does not trim text before a tool call`, () =>
    Effect.gen(function* () {
      const prepared = yield* compileRequest(
        LLM.request({
          model,
          messages: [
            Message.user("Look it up."),
            Message.assistant([
              { type: "reasoning", text: " Signed thinking \n", encrypted: "sig_1" },
              { type: "text", text: "", cache },
              { type: "text", text: "Calling the tool. \n" },
              ToolCallPart.make({ id: "call_1", name: "lookup", input: {} }),
            ]),
          ],
          cache: "none",
        }),
      )
      expect(prepared.body.messages).toEqual([
        { role: "user", content: [text("Look it up.")] },
        {
          role: "assistant",
          content: [
            bedrock
              ? { reasoningContent: { reasoningText: { text: " Signed thinking \n", signature: "sig_1" } } }
              : { type: "thinking", thinking: " Signed thinking \n", signature: "sig_1" },
            text("Calling the tool. \n"),
            bedrock
              ? { toolUse: { toolUseId: "call_1", name: "lookup", input: {} } }
              : { type: "tool_use", id: "call_1", name: "lookup", input: {} },
          ],
        },
      ])
    }),
  )
}

it.effect("Bedrock drops empty historical assistant text while retaining non-empty whitespace", () =>
  Effect.gen(function* () {
    const prepared = yield* compileRequest(
      LLM.request({
        model: bedrockRoute.model({ id: "global.anthropic.claude-haiku-4-5-20251001-v1:0" }),
        messages: [
          Message.user("First."),
          Message.assistant([{ type: "text", text: "", cache: new CacheHint({ type: "ephemeral" }) }]),
          Message.user("Second."),
          Message.assistant([
            { type: "text", text: "" },
            { type: "text", text: " \n\t" },
            { type: "text", text: "READY \n" },
          ]),
          Message.user("Continue."),
        ],
        cache: "none",
      }),
    )
    expect(prepared.body.messages).toEqual([
      { role: "user", content: [{ text: "First." }, { text: "Second." }] },
      { role: "assistant", content: [{ text: " \n\t" }, { text: "READY \n" }] },
      { role: "user", content: [{ text: "Continue." }] },
    ])
  }),
)
