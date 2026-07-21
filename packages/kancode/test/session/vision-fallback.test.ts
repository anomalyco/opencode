import { describe, expect, test } from "bun:test"
import type { ModelMessage } from "ai"
import { Effect, Layer, Stream } from "effect"
import { SessionV1 } from "@kancode/core/v1/session"
import { ProviderV2 } from "@kancode/core/provider"
import { ModelV2 } from "@kancode/core/model"
import { LLMEvent } from "@kancode/llm"
import { Provider } from "@/provider/provider"
import { LLM } from "../../src/session/llm"
import {
  hasUnsupportedMedia,
  describeUnsupported,
  isVisionFallbackPart,
  unpersistedSurfaces,
} from "../../src/session/vision-fallback"
import { testEffect } from "../lib/effect"

function model(input: { id?: string; image?: boolean; pdf?: boolean }): Provider.Model {
  return {
    id: input.id ?? "text-model",
    providerID: "test",
    name: "Test",
    limit: { context: 100_000, output: 8_000 },
    cost: { input: 0, output: 0, cache: { read: 0, write: 0 } },
    capabilities: {
      toolcall: true,
      attachment: false,
      reasoning: false,
      temperature: true,
      input: {
        text: true,
        image: input.image ?? false,
        audio: false,
        video: false,
        pdf: input.pdf ?? false,
      },
      output: { text: true, image: false, audio: false, video: false, pdf: false },
      interleaved: false,
    },
    api: { id: "test", npm: "@ai-sdk/openai-compatible", url: "http://localhost" },
    status: "active",
    headers: {},
    release_date: "2025-01-01",
    options: {},
  } as Provider.Model
}

const imagePart = {
  type: "file" as const,
  mediaType: "image/png",
  data: "data:image/png;base64,aaa",
}

const messagesWithImage: ModelMessage[] = [
  {
    role: "user",
    content: [{ type: "text", text: "look" }, imagePart],
  },
]

const user = {
  id: "msg_user",
  role: "user",
  sessionID: "ses_1",
  agent: "default",
  model: { providerID: "test", modelID: "text-model" },
  time: { created: 1 },
} as SessionV1.User

const target = { providerID: "test", modelID: "vision-model" }

describe("VisionFallback.hasUnsupportedMedia", () => {
  test("detects image parts the primary cannot accept", () => {
    expect(hasUnsupportedMedia(messagesWithImage, model({ image: false }))).toBe(true)
    expect(hasUnsupportedMedia(messagesWithImage, model({ image: true }))).toBe(false)
  })

  test("detects pdf parts the primary cannot accept", () => {
    const messagesWithPdf: ModelMessage[] = [
      {
        role: "user",
        content: [
          { type: "text", text: "read" },
          { type: "file", mediaType: "application/pdf", data: "data:application/pdf;base64,aaa" },
        ],
      },
    ]
    expect(hasUnsupportedMedia(messagesWithPdf, model({ pdf: false }))).toBe(true)
    expect(hasUnsupportedMedia(messagesWithPdf, model({ pdf: true }))).toBe(false)
    expect(hasUnsupportedMedia(messagesWithPdf, model({ image: true, pdf: false }))).toBe(true)
  })

  test("ignores text-only messages", () => {
    expect(
      hasUnsupportedMedia([{ role: "user", content: "hi" }], model({ image: false })),
    ).toBe(false)
  })
})

const it = testEffect(Layer.empty)

describe("VisionFallback.describeUnsupported", () => {
  it.effect("rewrites unsupported image to labeled description text", () =>
    Effect.gen(function* () {
      const primary = model({ id: "text-model", image: false })
      const fallback = model({ id: "vision-model", image: true })
      const out = yield* describeUnsupported({
        messages: messagesWithImage,
        model: primary,
        sessionID: "ses_1",
        user,
        fallback: target,
      }).pipe(
        Effect.provide(
          Layer.mergeAll(
            Layer.mock(Provider.Service, {
              getModel: (providerID, modelID) => {
                expect(providerID).toBe(ProviderV2.ID.make("test"))
                expect(modelID).toBe(ModelV2.ID.make("vision-model"))
                return Effect.succeed(fallback)
              },
            }),
            Layer.succeed(
              LLM.Service,
              LLM.Service.of({
                stream: () =>
                  Stream.make(
                    LLMEvent.textStart({ id: "t0" }),
                    LLMEvent.textDelta({ id: "t0", text: "A red button" }),
                    LLMEvent.textEnd({ id: "t0" }),
                  ),
              }),
            ),
          ),
        ),
      )

      const content = out.messages[0]
      expect(content?.role).toBe("user")
      if (content?.role !== "user" || !Array.isArray(content.content)) throw new Error("expected user parts")
      expect(content.content).toEqual([
        { type: "text", text: "look" },
        {
          type: "text",
          text: "[Image description via test/vision-model]\nA red button",
        },
      ])
      expect(out.surfaces).toEqual([
        {
          modality: "image",
          providerID: "test",
          modelID: "vision-model",
          text: "A red button",
        },
      ])
    }),
  )

  it.effect("leaves messages unchanged when primary already supports vision", () =>
    Effect.gen(function* () {
      const primary = model({ image: true })
      const out = yield* describeUnsupported({
        messages: messagesWithImage,
        model: primary,
        sessionID: "ses_1",
        user,
        fallback: target,
      }).pipe(
        Effect.provide(
          Layer.mergeAll(
            Layer.mock(Provider.Service, {
              getModel: () => Effect.die("should not load fallback"),
            }),
            Layer.succeed(
              LLM.Service,
              LLM.Service.of({
                stream: () => Stream.die("should not stream"),
              }),
            ),
          ),
        ),
      )
      expect(out.messages).toBe(messagesWithImage)
      expect(out.surfaces).toEqual([])
    }),
  )

  it.effect("leaves media unchanged when no fallback is configured", () =>
    Effect.gen(function* () {
      const primary = model({ image: false })
      const out = yield* describeUnsupported({
        messages: messagesWithImage,
        model: primary,
        sessionID: "ses_1",
        user,
        fallback: undefined,
      }).pipe(
        Effect.provide(
          Layer.mergeAll(
            Layer.mock(Provider.Service, {
              getModel: () => Effect.die("should not load fallback"),
            }),
            Layer.succeed(
              LLM.Service,
              LLM.Service.of({
                stream: () => Stream.die("should not stream"),
              }),
            ),
          ),
        ),
      )
      expect(out.messages).toBe(messagesWithImage)
      expect(out.surfaces).toEqual([])
    }),
  )

  it.effect("leaves media unchanged when describe returns empty text", () =>
    Effect.gen(function* () {
      const primary = model({ image: false })
      const fallback = model({ id: "vision-model", image: true })
      const out = yield* describeUnsupported({
        messages: messagesWithImage,
        model: primary,
        sessionID: "ses_1",
        user,
        fallback: target,
      }).pipe(
        Effect.provide(
          Layer.mergeAll(
            Layer.mock(Provider.Service, {
              getModel: () => Effect.succeed(fallback),
            }),
            Layer.succeed(
              LLM.Service,
              LLM.Service.of({
                stream: () => Stream.empty,
              }),
            ),
          ),
        ),
      )
      const content = out.messages[0]
      if (content?.role !== "user" || !Array.isArray(content.content)) throw new Error("expected user parts")
      expect(content.content[1]).toEqual(imagePart)
      expect(out.surfaces).toEqual([])
    }),
  )

  it.effect("uses reasoning deltas when content text is empty (Ollama Gemma4 quirk)", () =>
    Effect.gen(function* () {
      const primary = model({ id: "text-model", image: false })
      const fallback = model({ id: "vision-model", image: true })
      const out = yield* describeUnsupported({
        messages: messagesWithImage,
        model: primary,
        sessionID: "ses_1",
        user,
        fallback: target,
      }).pipe(
        Effect.provide(
          Layer.mergeAll(
            Layer.mock(Provider.Service, {
              getModel: () => Effect.succeed(fallback),
            }),
            Layer.succeed(
              LLM.Service,
              LLM.Service.of({
                stream: () =>
                  Stream.make(
                    LLMEvent.reasoningStart({ id: "r0" }),
                    LLMEvent.reasoningDelta({ id: "r0", text: "Logo with KanCode wordmark" }),
                    LLMEvent.reasoningEnd({ id: "r0" }),
                    // empty / missing text deltas — mirrors ollama gemma4 OpenAI-compat
                  ),
              }),
            ),
          ),
        ),
      )

      const content = out.messages[0]
      expect(content?.role).toBe("user")
      if (content?.role !== "user" || !Array.isArray(content.content)) throw new Error("expected user parts")
      expect(content.content).toEqual([
        { type: "text", text: "look" },
        {
          type: "text",
          text: "[Image description via test/vision-model]\nLogo with KanCode wordmark",
        },
      ])
      expect(out.surfaces[0]?.text).toBe("Logo with KanCode wordmark")
    }),
  )

  it.effect("prefers content text over reasoning when both are present", () =>
    Effect.gen(function* () {
      const primary = model({ id: "text-model", image: false })
      const fallback = model({ id: "vision-model", image: true })
      const out = yield* describeUnsupported({
        messages: messagesWithImage,
        model: primary,
        sessionID: "ses_1",
        user,
        fallback: target,
      }).pipe(
        Effect.provide(
          Layer.mergeAll(
            Layer.mock(Provider.Service, {
              getModel: () => Effect.succeed(fallback),
            }),
            Layer.succeed(
              LLM.Service,
              LLM.Service.of({
                stream: () =>
                  Stream.make(
                    LLMEvent.reasoningDelta({ id: "r0", text: "should not win" }),
                    LLMEvent.textDelta({ id: "t0", text: "Final caption" }),
                  ),
              }),
            ),
          ),
        ),
      )

      const content = out.messages[0]
      if (content?.role !== "user" || !Array.isArray(content.content)) throw new Error("expected user parts")
      expect(content.content[1]).toEqual({
        type: "text",
        text: "[Image description via test/vision-model]\nFinal caption",
      })
    }),
  )

  it.effect("surfaces only descriptions from the last user message", () =>
    Effect.gen(function* () {
      const primary = model({ id: "text-model", image: false })
      const fallback = model({ id: "vision-model", image: true })
      const history: ModelMessage[] = [
        {
          role: "user",
          content: [{ type: "text", text: "old" }, imagePart],
        },
        { role: "assistant", content: "ok" },
        {
          role: "user",
          content: [{ type: "text", text: "new" }, imagePart],
        },
      ]
      const out = yield* describeUnsupported({
        messages: history,
        model: primary,
        sessionID: "ses_1",
        user,
        fallback: target,
      }).pipe(
        Effect.provide(
          Layer.mergeAll(
            Layer.mock(Provider.Service, {
              getModel: () => Effect.succeed(fallback),
            }),
            Layer.succeed(
              LLM.Service,
              LLM.Service.of({
                stream: () =>
                  Stream.make(
                    LLMEvent.textDelta({ id: "t0", text: "caption" }),
                    LLMEvent.textEnd({ id: "t0" }),
                  ),
              }),
            ),
          ),
        ),
      )
      expect(out.surfaces).toEqual([
        {
          modality: "image",
          providerID: "test",
          modelID: "vision-model",
          text: "caption",
        },
      ])
      // Both user messages still rewritten for the primary outbound path.
      expect(out.messages).toHaveLength(3)
    }),
  )
})

describe("VisionFallback.isVisionFallbackPart", () => {
  test("detects metadata flag on text parts", () => {
    expect(
      isVisionFallbackPart({
        type: "text",
        metadata: { visionFallback: true },
      }),
    ).toBe(true)
    expect(isVisionFallbackPart({ type: "text", metadata: {} })).toBe(false)
    expect(isVisionFallbackPart({ type: "file" })).toBe(false)
  })
})

describe("VisionFallback.unpersistedSurfaces", () => {
  const surface = (text: string) => ({
    modality: "image" as const,
    providerID: "test",
    modelID: "vision",
    text,
  })

  test("returns all surfaces when nothing persisted yet", () => {
    expect(unpersistedSurfaces([], [surface("A"), surface("B")])).toEqual([
      surface("A"),
      surface("B"),
    ])
  })

  test("skips surfaces whose text is already persisted", () => {
    const parts = [
      { type: "text", text: "prompt" },
      { type: "text", text: "B", metadata: { visionFallback: true } },
    ]
    expect(unpersistedSurfaces(parts, [surface("A"), surface("B")])).toEqual([surface("A")])
  })

  test("returns empty when every surface is already present", () => {
    const parts = [{ type: "text", text: "A", metadata: { visionFallback: true } }]
    expect(unpersistedSurfaces(parts, [surface("A")])).toEqual([])
  })
})
