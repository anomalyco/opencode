import { expect } from "bun:test"
import { Effect, Schema } from "effect"
import { LLM, Message } from "../../src/index.js"
import { OpenAI, Azure, XAI } from "../../src/providers.js"
import { compileRequest } from "../../src/route/client.js"
import { it } from "../lib/effect.js"

for (const model of [
  OpenAI.configure({ apiKey: "test" }).responses("fixture"),
  Azure.configure({ apiKey: "test", resourceName: "test" }).responses("fixture"),
  XAI.configure({ apiKey: "test" }).responses("fixture"),
]) {
  it.effect(`${model.provider} preserves image detail through message serialization and lowering`, () =>
    Effect.gen(function* () {
      const details = [undefined, "low", "high", "auto"]
      const message = Message.user(
        details.map((detail) => ({
          type: "media",
          mediaType: "image/png",
          data: "https://example.com/image.png",
          providerMetadata:
            detail === undefined ? undefined : { [model.route.providerMetadataKey ?? model.provider]: { detail } },
        })),
      )
      const codec = Schema.fromJsonString(Message)
      const prepared = yield* compileRequest(
        LLM.request({
          model,
          messages: [Schema.decodeSync(codec)(Schema.encodeSync(codec)(message))],
        }),
      )
      expect(prepared.body.input[0].content).toEqual(
        details.map((detail) => ({
          type: "input_image",
          image_url: "https://example.com/image.png",
          detail,
        })),
      )
    }),
  )
}

it.effect("rejects malformed image detail instead of silently discarding it", () =>
  Effect.gen(function* () {
    const error = yield* compileRequest(
      LLM.request({
        model: OpenAI.configure({ apiKey: "test" }).responses("fixture"),
        messages: [
          Message.user({
            type: "media",
            mediaType: "image/png",
            data: "https://example.com/image.png",
            providerMetadata: { openai: { detail: 42 } },
          }),
        ],
      }),
    ).pipe(Effect.flip)
    expect(error.reason._tag).toBe("InvalidRequest")
  }),
)
