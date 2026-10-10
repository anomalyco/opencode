import { describe, expect } from "bun:test"
import { LLMEvent, Model, type LLMRequest } from "@opencode-ai/llm"
import * as OpenAIChat from "@opencode-ai/llm/protocols/openai-chat"
import { Catalog } from "@opencode-ai/core/catalog"
import { Config } from "@opencode-ai/core/config"
import { ConfigExperimental } from "@opencode-ai/core/config/experimental"
import { ModelV2 } from "@opencode-ai/core/model"
import { ProjectV2 } from "@opencode-ai/core/project"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { SessionRunnerModel } from "@opencode-ai/core/session/runner/model"
import { SessionVision } from "@opencode-ai/core/session/runner/vision"
import { SessionV2 } from "@opencode-ai/core/session"
import { SessionMessage } from "@opencode-ai/core/session/message"
import { FileAttachment } from "@opencode-ai/core/session/prompt"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { DateTime, Effect, Layer, Stream } from "effect"
import { testEffect } from "./lib/effect"

const created = DateTime.makeUnsafe(0)
const id = (value: string) => SessionMessage.ID.make(`msg_${value}`)

let catalogModels: ModelV2.Info[] = []
let configuredVisionModel: string | undefined
let transcribeChunks: string[] = []
const requests: LLMRequest[] = []

const catalogModel = (input: { id: string; image?: boolean; status?: "active" | "deprecated"; released?: number }) =>
  ModelV2.Info.make({
    id: ModelV2.ID.make(input.id),
    providerID: ProviderV2.ID.make("prov"),
    name: input.id,
    api: {
      id: ModelV2.ID.make(input.id),
      type: "aisdk",
      package: "@ai-sdk/anthropic",
      url: "https://anthropic.example/v1",
    },
    capabilities: {
      tools: true,
      input: input.image === false ? ["text"] : ["text", "image"],
      output: ["text"],
    },
    request: { headers: {}, body: {} },
    variants: [],
    time: { released: input.released ?? 0 },
    cost: [],
    status: input.status ?? "active",
    enabled: true,
    limit: { context: 100, output: 20 },
  })

const session = SessionV2.Info.make({
  id: SessionV2.ID.make("ses_vision"),
  projectID: ProjectV2.ID.global,
  title: "test",
  cost: 0,
  tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
  time: { created, updated: created },
  location: { directory: AbsolutePath.make("/project") },
})

const user = (files?: FileAttachment[]) =>
  SessionMessage.User.make({ id: id("user"), type: "user", text: "Inspect this", files, time: { created } })

const image = FileAttachment.make({ uri: "data:image/png;base64,aGVsbG8=", mime: "image/png", name: "shot.png" })
const document = FileAttachment.make({ uri: "file:///notes.txt", mime: "text/plain", name: "notes.txt" })

const selectedModel = (model: ModelV2.Info) =>
  Model.make({ id: String(model.id), provider: String(model.providerID), route: OpenAIChat.route })

const reset = (input: { models: ModelV2.Info[]; visionModel?: string; chunks?: string[] }) => {
  catalogModels = input.models
  configuredVisionModel = input.visionModel
  transcribeChunks = input.chunks ?? []
  requests.length = 0
}

const currentModel = () => selectedModel(catalogModels[0])

const it = testEffect(
  Layer.effect(
    SessionVision.Service,
    Effect.gen(function* () {
      const experimental =
        configuredVisionModel === undefined
          ? undefined
          : new ConfigExperimental.Experimental({ vision_model: configuredVisionModel })
      const config = Config.Service.of({
        entries: () =>
          Effect.succeed([new Config.Document({ type: "document", info: new Config.Info({ experimental }) })]),
      })
      const catalog = Catalog.Service.of({
        transform: () => Effect.die("unused"),
        reload: () => Effect.void,
        provider: {
          get: () => Effect.succeed(undefined),
          all: () => Effect.succeed([]),
          available: () => Effect.succeed([]),
        },
        model: {
          get: (providerID, modelID) =>
            Effect.succeed(catalogModels.find((model) => model.providerID === providerID && model.id === modelID)),
          all: () => Effect.succeed(catalogModels),
          available: () => Effect.succeed(catalogModels),
          default: () => Effect.succeed(undefined),
          small: () => Effect.succeed(undefined),
        },
      })
      const models = SessionRunnerModel.Service.of({
        resolve: () => Effect.die("unused"),
        resolveInfo: (input, info) => SessionRunnerModel.resolve(input, info),
      })
      const stream = (request: LLMRequest) => {
        requests.push(request)
        return Stream.fromIterable(
          transcribeChunks.map((text, index) => LLMEvent.textDelta({ id: String(index), text })),
        )
      }
      return yield* SessionVision.make({ catalog, models, config, stream })
    }),
  ),
)

describe("SessionVision", () => {
  it.effect("passes messages through when the selected model supports image input", () =>
    Effect.gen(function* () {
      reset({ models: [catalogModel({ id: "vision", image: true })] })
      const vision = yield* SessionVision.Service
      const messages = [user([image])]

      const bridged = yield* vision.bridge({ session, model: currentModel(), messages })

      expect(bridged).toEqual(messages)
      expect(requests).toEqual([])
    }),
  )

  it.effect("replaces image attachments with transcripts from a same-provider vision model", () =>
    Effect.gen(function* () {
      reset({ models: [catalogModel({ id: "text-only", image: false }), catalogModel({ id: "vision", released: 10 })], chunks: ["Button labeled ", "Submit"] })
      const vision = yield* SessionVision.Service

      const bridged = yield* vision.bridge({
        session,
        model: currentModel(),
        messages: [user([image, document])],
      })

      expect(bridged).toHaveLength(2)
      expect(bridged[0]?.type).toBe("user")
      expect(bridged[0]?.type === "user" ? bridged[0]?.files : undefined).toEqual([document])
      expect(bridged[1]?.type).toBe("synthetic")
      expect(bridged[1]?.type === "synthetic" ? bridged[1]?.text : undefined).toBe(
        "[Image: shot.png]\nButton labeled Submit",
      )
      expect(requests).toHaveLength(1)
      expect(String(requests[0]?.model.id)).toBe("vision")
      expect(String(requests[0]?.model.provider)).toBe("prov")
      expect(JSON.stringify(requests[0]?.messages)).toContain(image.uri)
    }),
  )

  it.effect("keeps messages unchanged when the provider has no other active vision model", () =>
    Effect.gen(function* () {
      reset({ models: [catalogModel({ id: "text-only", image: false })] })
      const vision = yield* SessionVision.Service
      const messages = [user([image])]

      const bridged = yield* vision.bridge({ session, model: currentModel(), messages })

      expect(bridged).toEqual(messages)
      expect(requests).toEqual([])
    }),
  )

  it.effect("ignores deprecated vision candidates", () =>
    Effect.gen(function* () {
      reset({
        models: [
          catalogModel({ id: "text-only", image: false }),
          catalogModel({ id: "old-vision", status: "deprecated", released: 100 }),
        ],
      })
      const vision = yield* SessionVision.Service
      const messages = [user([image])]

      const bridged = yield* vision.bridge({ session, model: currentModel(), messages })

      expect(bridged).toEqual(messages)
      expect(requests).toEqual([])
    }),
  )

  it.effect("prefers the configured vision_model override", () =>
    Effect.gen(function* () {
      reset({
        models: [catalogModel({ id: "text-only", image: false }), catalogModel({ id: "vision", released: 10 })],
        visionModel: "prov/vision",
        chunks: ["Transcribed"],
      })
      const vision = yield* SessionVision.Service

      const bridged = yield* vision.bridge({
        session,
        model: currentModel(),
        messages: [user([image])],
      })

      expect(bridged).toHaveLength(2)
      expect(String(requests[0]?.model.id)).toBe("vision")
    }),
  )

  it.effect("caches transcripts per attachment across turns", () =>
    Effect.gen(function* () {
      reset({
        models: [catalogModel({ id: "text-only", image: false }), catalogModel({ id: "vision", released: 10 })],
        chunks: ["Transcribed"],
      })
      const vision = yield* SessionVision.Service

      const first = yield* vision.bridge({
        session,
        model: currentModel(),
        messages: [user([image])],
      })
      const second = yield* vision.bridge({
        session,
        model: currentModel(),
        messages: [user([image])],
      })

      expect(first).toHaveLength(2)
      expect(second).toHaveLength(2)
      expect(second[1]?.type === "synthetic" ? second[1]?.text : undefined).toBe(
        first[1]?.type === "synthetic" ? first[1]?.text : undefined,
      )
      expect(requests).toHaveLength(1)
    }),
  )

  it.effect("keeps the original image when transcription returns nothing", () =>
    Effect.gen(function* () {
      reset({
        models: [catalogModel({ id: "text-only", image: false }), catalogModel({ id: "vision", released: 10 })],
      })
      const vision = yield* SessionVision.Service
      const messages = [user([image])]

      const bridged = yield* vision.bridge({ session, model: currentModel(), messages })

      expect(bridged).toEqual(messages)
      expect(requests).toHaveLength(1)
    }),
  )
})
