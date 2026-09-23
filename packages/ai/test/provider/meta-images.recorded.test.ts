import { expect } from "bun:test"
import { Effect } from "effect"
import { Image, LLM, LLMEvent, LLMRequest, Media, Message } from "../../src/index.js"
import { Meta } from "../../src/providers/meta.js"
import { LLMClient } from "../../src/route.js"
import { compileRequest } from "../../src/route/client.js"
import { recordedTests } from "../recorded-test.js"

const meta = Meta.configure({ apiKey: process.env.META_API_KEY ?? "fixture" })
const modelID = "muse-image-1.0"
const recorded = recordedTests({
  prefix: "meta-images",
  provider: "meta",
  requires: ["META_API_KEY"],
  tags: ["image"],
  metadata: { model: modelID },
})
const controls = {
  reasoningStrength: "low",
  toolEnablement: { enable_image_search: false, enable_web_search: false, enable_shell: false },
} as const

recorded.effect.with(
  "generates default WEBP bytes",
  { protocol: "meta-images", tags: ["generation", "webp"] },
  () =>
    Effect.gen(function* () {
      const response = yield* Image.generate({
        model: meta.image(modelID),
        prompt: "A flat black square centered on a plain white background. No text.",
        n: 1,
        size: "256x256",
        providerOptions: controls,
      })
      expect(response.images).toHaveLength(1)
      expect(response.image.mediaType).toBe("image/webp")
      const bytes = yield* response.image.bytes()
      expect(new TextDecoder().decode(bytes.slice(0, 4))).toBe("RIFF")
      expect(new TextDecoder().decode(bytes.slice(8, 12))).toBe("WEBP")
      expect(response.usage?.type === "tokens" ? response.usage.output : undefined).toBeGreaterThan(0)
    }),
  180_000,
)

recorded.effect.with(
  "edits image bytes and returns PNG",
  { protocol: "meta-images", tags: ["editing", "png"] },
  () =>
    Effect.gen(function* () {
      const response = yield* Image.generate({
        model: meta.image(modelID),
        prompt: "Change the shape to bright purple. Keep the plain white background.",
        images: [
          Media.bytes(
            yield* Effect.promise(() => Bun.file("test/fixtures/images/edit-source.jpg").bytes()),
            "image/jpeg",
          ),
        ],
        n: 1,
        size: "256x256",
        format: "png",
        providerOptions: controls,
      })
      expect(response.image.mediaType).toBe("image/png")
      expect(Array.from((yield* response.image.bytes()).slice(0, 8))).toEqual([137, 80, 78, 71, 13, 10, 26, 10])
    }),
  180_000,
)

recorded.effect.with(
  "replays a signed image handle for a Responses edit",
  { protocol: "meta-responses", tags: ["hosted", "continuation", "editing"] },
  () =>
    Effect.gen(function* () {
      const request = LLM.request({
        model: meta.responses(modelID),
        prompt: "A simple flat black square centered on a plain white background. No text.",
        tools: [
          Meta.imageGeneration({
            reasoningStrength: "low",
            enableImageSearch: false,
            enableWebSearch: false,
            enableShell: false,
            size: "1024x1024",
          }),
        ],
        generation: { maxTokens: 4096 },
      })
      const compiled = yield* compileRequest(request)
      expect(compiled.body.tools).toMatchObject([
        { type: "image_generation", reasoning_strength: "low", enable_web_search: false, size: "1024x1024" },
      ])
      const first = yield* LLMClient.generate(request)
      const image = first.events.filter(LLMEvent.is.toolResult).find((event) => event.name === "image_generation")
      expect(image?.providerExecuted).toBe(true)
      expect(structuredClone(image?.result)).toMatchObject({
        type: "content",
        value: [{ type: "file", mime: "image/webp", uri: expect.stringMatching(/^data:image\/webp;base64,/) }],
      })
      const next = LLMRequest.update(request, {
        messages: [
          ...request.messages,
          first.message,
          Message.user("Change the square to blue. Keep the white background."),
        ],
      })
      const replay = yield* compileRequest(next)
      expect(replay.body.input).toEqual(
        expect.arrayContaining([{ type: "image_generation_call", id: image?.id, status: "completed", result: null }]),
      )
      expect(JSON.stringify(replay.body.input)).not.toContain("data:image")
      const second = yield* LLMClient.generate(next)
      expect(
        second.events.some(
          (event) => LLMEvent.is.toolResult(event) && event.name === "image_generation" && event.providerExecuted,
        ),
      ).toBe(true)
      expect(second.finishReason.normalized).toBe("stop")
    }),
  240_000,
)
