import { expect } from "bun:test"
import { Effect, Schema } from "effect"
import { LLM, Message, ToolCallPart } from "../../src/index.js"
import { AmazonBedrock } from "../../src/providers.js"
import { BedrockConverse } from "../../src/protocols/bedrock-converse.js"
import { compileRequest } from "../../src/route/client.js"
import { it } from "../lib/effect.js"

const bedrock = AmazonBedrock.configure({ baseURL: "https://bedrock.test", apiKey: "test-key" })
const history = (ids: string[]) => [
  Message.user("Read every label"),
  Message.assistant(ids.map((id, index) => ToolCallPart.make({ id, name: "lookup", input: { label: index } }))),
  ...ids.map((id, index) => Message.tool({ id, name: "lookup", result: `value-${index}` })).toReversed(),
]

for (const model of [
  "mistral.mistral-large-2407-v1:0",
  "us.mistral.pixtral-large-2502-v1:0",
  "arn:aws:bedrock:us-east-1::foundation-model/mistral.pixtral-large-2502-v1:0",
]) {
  it.effect(`preserves distinct call/result pairs and history for ${model}`, () =>
    Effect.gen(function* () {
      const request = LLM.request({ model: bedrock.model(model), messages: history(["a"]), cache: "none" })
      const first = Schema.decodeUnknownSync(BedrockConverse.protocol.body.schema)(
        (yield* compileRequest(request)).body,
      )
      const reserved = first.messages.flatMap((message) =>
        message.content.flatMap((part) => ("toolUse" in part ? [part.toolUse.toolUseId] : [])),
      )[0]
      if (!reserved) throw new Error("Expected projected tool call")
      const ids = [
        "a",
        "b",
        "tooluse_GQn7COr2AN8bw2oVKYyYzZ",
        "tooluse_abcdefghi111111111",
        "tooluse_abcdefghi222222222",
        "call_other-provider-id",
        "Ab12Cd34E",
        reserved,
      ]
      const messages = history(ids)
      const before = structuredClone(messages)
      const input = LLM.request({ model: bedrock.model(model), messages, cache: "none" })
      const prepared = yield* compileRequest(input)
      const body = Schema.decodeUnknownSync(BedrockConverse.protocol.body.schema)(prepared.body)
      const calls = body.messages.flatMap((message) =>
        message.content.flatMap((part) => ("toolUse" in part ? [part.toolUse.toolUseId] : [])),
      )
      const results = body.messages.flatMap((message) =>
        message.content.flatMap((part) => ("toolResult" in part ? [part.toolResult.toolUseId] : [])),
      )
      expect(calls).toHaveLength(ids.length)
      expect(new Set(calls).size).toBe(ids.length)
      calls.forEach((id) => expect(id).toMatch(/^[A-Za-z0-9]{9}$/))
      expect(results).toEqual(calls.toReversed())
      expect(calls[0]).not.toBe(reserved)
      expect(calls.slice(-2)).toEqual(ids.slice(-2))
      expect((yield* compileRequest(input)).body).toEqual(prepared.body)
      expect(structuredClone(messages)).toEqual(before)
    }),
  )
}

it.effect("leaves non-Mistral Bedrock IDs unchanged", () =>
  Effect.gen(function* () {
    const ids = ["a", "tooluse_abcdefghi111111111", "tooluse_abcdefghi222222222", "Ab12Cd34E"]
    const prepared = yield* compileRequest(
      LLM.request({
        model: bedrock.model("global.anthropic.claude-haiku-4-5-20251001-v1:0"),
        messages: history(ids),
        cache: "none",
      }),
    )
    const body = Schema.decodeUnknownSync(BedrockConverse.protocol.body.schema)(prepared.body)
    expect(
      body.messages.flatMap((message) =>
        message.content.flatMap((part) => ("toolUse" in part ? [part.toolUse.toolUseId] : [])),
      ),
    ).toEqual(ids)
    expect(
      body.messages.flatMap((message) =>
        message.content.flatMap((part) => ("toolResult" in part ? [part.toolResult.toolUseId] : [])),
      ),
    ).toEqual(ids.toReversed())
  }),
)
