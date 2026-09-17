import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { HttpClientRequest } from "effect/unstable/http"
import { Image, ImageClient, ImageModel, LLM, ModelID, ModelRef, ProviderID, type LanguageModel } from "../src/index.js"
import { Anthropic, Google, OpenAI } from "../src/providers.js"
import { compileRequest } from "../src/route/client.js"
import { it } from "./lib/effect.js"
import { dynamicResponse } from "./lib/http.js"

describe("ModelRef", () => {
  it.effect("callable facades return refs that resolve to the default LLM route", () =>
    Effect.gen(function* () {
      const openai = OpenAI.configure({ apiKey: "test", baseURL: "https://openai.test/v1" })
      const ref = openai("gpt-5")
      expect(ref).toBeInstanceOf(ModelRef)
      expect(ref.id).toBe(ModelID.make("gpt-5"))
      expect(ref.provider).toBe(ProviderID.make("openai"))

      const request = LLM.request({ model: ref, prompt: "Hello", providerOptions: { reasoningEffort: "high" } })
      expect(request.model.id).toBe(ModelID.make("gpt-5"))
      expect(request.model.route.id).toBe("openai-responses")
      expect(request.model.provider).toBe(openai.responses("gpt-5").provider)
      expect(LLM.request({ model: openai.chat("gpt-4o"), prompt: "Hello" }).model.route.id).toBe("openai-chat")

      const prepared = yield* compileRequest(request)
      expect(prepared.route).toBe("openai-responses")
      expect(prepared.body).toMatchObject({ model: "gpt-5", reasoning: { effort: "high" } })
    }),
  )

  it.effect("resolves the image route for image requests", () =>
    Effect.gen(function* () {
      const openai = OpenAI.configure({ apiKey: "test", baseURL: "https://openai.test/v1" })
      const request = Image.request({
        model: openai("gpt-image-2"),
        prompt: "A lighthouse",
        providerOptions: { quality: "high" },
      })
      expect(request.model).toBeInstanceOf(ImageModel)
      expect(request.model.id).toBe(ModelID.make("gpt-image-2"))
      expect(request.model.route.id).toBe("openai-images")
      expect(
        Image.request({ model: Google.configure({ apiKey: "test" })("gemini-image"), prompt: "x" }).model.route.id,
      ).toBe("google-images")

      const response = yield* Image.generate({ model: openai("gpt-image-2"), prompt: "A lighthouse" }).pipe(
        Effect.provide(
          ImageClient.layer.pipe(
            Layer.provide(
              dynamicResponse((input) =>
                Effect.gen(function* () {
                  const web = yield* HttpClientRequest.toWeb(input.request).pipe(Effect.orDie)
                  expect(web.url).toBe("https://openai.test/v1/images/generations")
                  expect(JSON.parse(input.text)).toEqual({ model: "gpt-image-2", prompt: "A lighthouse" })
                  return input.respond(JSON.stringify({ data: [{ b64_json: "AQID" }] }), {
                    headers: { "content-type": "application/json" },
                  })
                }),
              ),
            ),
          ),
        ),
      )
      expect(response.image.source).toEqual({ type: "bytes", data: Uint8Array.from([1, 2, 3]), mediaType: "image/png" })
    }),
  )

  it.effect("fails typed when a provider has no route for the requested modality", () =>
    Effect.gen(function* () {
      const ref = Anthropic.configure({ apiKey: "test" })("claude-sonnet-4-5")
      expect("image" in ref.facade).toBe(false)
      const error = yield* Image.generate({
        // The type system rejects this; the runtime must still fail with a typed error.
        model: ref as unknown as ModelRef.WithImage,
        prompt: "A lighthouse",
      }).pipe(
        Effect.flip,
        Effect.provide(
          ImageClient.layer.pipe(Layer.provide(dynamicResponse(() => Effect.die("unrouted request reached HTTP")))),
        ),
      )
      expect(error.reason._tag).toBe("UnsupportedOperation")
      expect(error.message).toContain("anthropic does not expose an image route")
    }),
  )

  it.effect("resolves selectors lazily and keeps the facade as the source of truth", () =>
    Effect.sync(() => {
      let built = 0
      const model = OpenAI.configure({ apiKey: "test" }).responses("gpt-5")
      const facade = ModelRef.facade({
        id: model.provider,
        model: (id): LanguageModel => {
          built += 1
          return OpenAI.configure({ apiKey: "test" }).responses(id)
        },
        configure: () => undefined,
      })
      const ref = facade("gpt-5")
      expect(built).toBe(0)
      expect(ref.facade.model).toBe(facade.model)
      expect(ref.provider).toBe(model.provider)
      expect(LLM.request({ model: ref, prompt: "Hi" }).model.id).toBe(ModelID.make("gpt-5"))
      expect(built).toBe(1)
      expect(facade.model(ModelID.make("gpt-4o")).id).toBe(ModelID.make("gpt-4o"))
    }),
  )
})
