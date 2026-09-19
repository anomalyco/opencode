import { describe, expect } from "bun:test"
import { Effect, Layer, Stream } from "effect"
import { SessionV1 } from "@opencode-ai/core/v1/session"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { ModelV2 } from "@opencode-ai/core/model"
import { LLMEvent } from "@opencode-ai/llm"
import { Provider } from "@/provider/provider"
import { LLM } from "@/session/llm"
import { SessionVision } from "@/session/vision"
import { MessageID, PartID, SessionID } from "@/session/schema"
import { testEffect } from "../lib/effect"
import { TestConfig } from "../fixture/config"

const sessionID = SessionID.make("session-vision")
const messageID = MessageID.make("msg_vision")

function model(input: {
  providerID: string
  id: string
  image?: boolean
  status?: "alpha" | "beta" | "deprecated" | "active"
  cost?: number
  release?: string
}): Provider.Model {
  return {
    id: ModelV2.ID.make(input.id),
    providerID: ProviderV2.ID.make(input.providerID),
    api: { id: input.id, url: "https://example.com", npm: "@ai-sdk/openai-compatible" },
    name: input.id,
    capabilities: {
      temperature: false,
      reasoning: false,
      attachment: input.image ?? false,
      toolcall: true,
      input: { text: true, audio: false, image: input.image ?? false, video: false, pdf: false },
      output: { text: true, audio: false, image: false, video: false, pdf: false },
      interleaved: false,
    },
    cost: { input: input.cost ?? 0, output: 0, cache: { read: 0, write: 0 } },
    limit: { context: 100000, output: 10000 },
    status: input.status ?? "active",
    options: {},
    headers: {},
    release_date: input.release ?? "2025-01-01",
  }
}

function info(id: string, models: Provider.Model[]): Provider.Info {
  return {
    id: ProviderV2.ID.make(id),
    name: id,
    source: "config",
    env: [],
    options: {},
    models: Object.fromEntries(models.map((item) => [item.id, item])),
  }
}

const textModel = model({ providerID: "test", id: "text-only" })
const visionModel = model({ providerID: "test", id: "vision", image: true, release: "2025-06-01" })
const otherVision = model({ providerID: "other", id: "vision", image: true, release: "2025-06-01" })

function user(): SessionV1.User {
  return {
    id: messageID,
    sessionID,
    role: "user",
    time: { created: 0 },
    agent: "build",
    model: { providerID: ProviderV2.ID.make("test"), modelID: ModelV2.ID.make("text-only") },
  }
}

function imagePart(id: string): SessionV1.FilePart {
  return {
    id: PartID.make(id),
    sessionID,
    messageID,
    type: "file",
    mime: "image/png",
    filename: "shot.png",
    url: "data:image/png;base64,AAAA",
  }
}

function textPart(): SessionV1.TextPart {
  return { id: PartID.make("prt_text"), sessionID, messageID, type: "text", text: "look at this" }
}

function messages(parts: SessionV1.Part[]): SessionV1.WithParts[] {
  return [{ info: user(), parts }]
}

function env(input: { providers: Provider.Info[]; transcription?: string }) {
  const calls = { count: 0 }
  const provider = Layer.mock(Provider.Service, {
    list: () => Effect.succeed(Object.fromEntries(input.providers.map((item) => [item.id, item]))),
    getModel: (providerID, modelID) =>
      Effect.sync(() => {
        const found = input.providers
          .flatMap((item) => Object.values(item.models))
          .find((item) => item.providerID === providerID && item.id === modelID)
        if (!found) throw new Error("model not found")
        return found
      }),
  })
  const config = TestConfig.layer()
  const llm = Layer.mock(LLM.Service, {
    stream: () => {
      calls.count++
      return Stream.make(LLMEvent.textDelta({ id: "text-0", text: input.transcription ?? "transcribed text" }))
    },
  })
  return {
    calls,
    layer: SessionVision.layer.pipe(Layer.provide(Layer.mergeAll(provider, config, llm))),
  }
}

const available = env({ providers: [info("test", [textModel, visionModel])] })
const visionCapable = env({ providers: [info("test", [textModel, visionModel])] })
const onlyText = env({ providers: [info("test", [textModel])] })
const cached = env({ providers: [info("test", [textModel, visionModel])] })
const crossProvider = env({ providers: [info("test", [textModel]), info("other", [otherVision])] })

const itAvailable = testEffect(available.layer)
const itVisionCapable = testEffect(visionCapable.layer)
const itOnlyText = testEffect(onlyText.layer)
const itCached = testEffect(cached.layer)
const itCrossProvider = testEffect(crossProvider.layer)

describe("SessionVision.bridge", () => {
  itAvailable.effect("transcribes images for models without vision support", () =>
    Effect.gen(function* () {
      const vision = yield* SessionVision.Service
      const input = messages([textPart(), imagePart("prt_image")])
      const output = yield* vision.bridge({ messages: input, model: textModel, user: user() })

      expect(output).not.toBe(input)
      expect(output[0]?.parts).toHaveLength(2)
      expect(output[0]?.parts[1]).toMatchObject({ type: "text", synthetic: true })
      const part = output[0]?.parts[1]
      const text = part && part.type === "text" ? part.text : ""
      expect(text).toContain("transcribed text")
      expect(text).toContain("shot.png")
      expect(input[0]?.parts[1]?.type).toBe("file")
      expect(available.calls.count).toBe(1)
    }),
  )

  itVisionCapable.effect("skips transcription when the model already supports vision", () =>
    Effect.gen(function* () {
      const vision = yield* SessionVision.Service
      const input = messages([imagePart("prt_image")])
      const output = yield* vision.bridge({ messages: input, model: visionModel, user: user() })

      expect(output).toBe(input)
      expect(visionCapable.calls.count).toBe(0)
    }),
  )

  itOnlyText.effect("leaves messages untouched when no vision model is available", () =>
    Effect.gen(function* () {
      const vision = yield* SessionVision.Service
      const input = messages([imagePart("prt_image")])
      const output = yield* vision.bridge({ messages: input, model: textModel, user: user() })

      expect(output).toBe(input)
      expect(onlyText.calls.count).toBe(0)
    }),
  )

  itCached.effect("caches transcripts per image part", () =>
    Effect.gen(function* () {
      const vision = yield* SessionVision.Service
      const input = messages([imagePart("prt_image")])
      yield* vision.bridge({ messages: input, model: textModel, user: user() })
      yield* vision.bridge({ messages: input, model: textModel, user: user() })

      expect(cached.calls.count).toBe(1)
    }),
  )

  itCrossProvider.effect("never uses another provider's vision model", () =>
    Effect.gen(function* () {
      const vision = yield* SessionVision.Service
      const input = messages([imagePart("prt_image")])
      const output = yield* vision.bridge({ messages: input, model: textModel, user: user() })

      expect(output).toBe(input)
      expect(crossProvider.calls.count).toBe(0)
    }),
  )
})
