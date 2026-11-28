import { expect } from "bun:test"
import { Effect, Schema } from "effect"
import { ai, Media, Message } from "../../src/effect.js"
import { OpenAI, Azure, XAI } from "../../src/providers.js"
import { compileRequest } from "../../src/route/client.js"
import { it } from "../lib/effect.js"

for (const model of [
  OpenAI.openai.with({ apiKey: "test" }).model("fixture"),
  Azure.model("fixture", { apiKey: "test", resourceName: "test" }),
  XAI.model("fixture", { apiKey: "test" }),
]) {
  it.effect(`${model.provider} preserves image detail through message serialization and lowering`, () =>
    Effect.gen(function* () {
      const details = [undefined, "low", "high", "auto"]
      const message = Message.user(
        details.map((detail) => ({
          type: "media",
          media: Media.url("https://example.com/image.png", { mediaType: "image/png" }),
          providerMetadata: detail === undefined ? undefined : { [model.metadataKey]: { detail } },
        })),
      )
      const codec = Schema.fromJsonString(Message)
      const prepared = yield* compileRequest(
        ai.request({
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
      ai.request({
        model: OpenAI.openai.with({ apiKey: "test" }).model("fixture"),
        messages: [
          Message.user({
            type: "media",
            media: Media.url("https://example.com/image.png", { mediaType: "image/png" }),
            providerMetadata: { openai: { detail: 42 } },
          }),
        ],
      }),
    ).pipe(Effect.flip)
    expect(error.reason._tag).toBe("InvalidRequest")
  }),
)
