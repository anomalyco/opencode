export * as SessionVision from "./vision"

import { LLM, LLMClient, LLMEvent, Message, type LLMClientShape, type Model } from "@opencode-ai/llm"
import { Context, DateTime, Effect, Layer, Stream } from "effect"
import { Catalog } from "../../catalog"
import { Config } from "../../config"
import { makeLocationNode } from "../../effect/app-node"
import { llmClient } from "../../effect/app-node-platform"
import { ModelV2 } from "../../model"
import { ProviderV2 } from "../../provider"
import { SessionMessage } from "../message"
import type { FileAttachment } from "../prompt"
import { SessionSchema } from "../schema"
import { SessionRunnerModel } from "./model"

const TRANSCRIBE_INSTRUCTION = `Describe this image for a developer who cannot see it.
Transcribe all visible text verbatim, including code, error messages, terminal output, and UI labels.
If there is little or no text, describe the visual content instead: layout, components, colors, and anything a developer would need to understand it.`

export interface Dependencies {
  readonly catalog: Catalog.Interface
  readonly models: SessionRunnerModel.Interface
  readonly config: Config.Interface
  readonly stream: LLMClientShape["stream"]
}

export interface Interface {
  /** Replace image attachments with transcripts when the selected model cannot see images. */
  readonly bridge: (input: {
    readonly session: SessionSchema.Info
    readonly model: Model
    readonly messages: ReadonlyArray<SessionMessage.Message>
  }) => Effect.Effect<ReadonlyArray<SessionMessage.Message>>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/v2/SessionVision") {}

/** Test or embedding seam for supplying catalog, model resolution, config, and LLM clients directly. */
export const make = (deps: Dependencies) =>
  Effect.gen(function* () {
    const supportsImages = (model: ModelV2.Info) => model.capabilities.input.includes("image")

    // Transcripts are keyed by message and attachment URI so a multi-step
    // session only pays for each image once.
    const cache = new Map<string, string>()

    const transcribe = Effect.fn("SessionVision.transcribe")(function* (input: {
      key: string
      model: Model
      file: FileAttachment
    }) {
      const cached = cache.get(input.key)
      if (cached !== undefined) return cached
      const text = yield* deps
        .stream(
          LLM.request({
            model: input.model,
            messages: [
              Message.make({
                id: SessionMessage.ID.create(),
                role: "user",
                content: [
                  { type: "text", text: TRANSCRIBE_INSTRUCTION },
                  { type: "media", mediaType: input.file.mime, data: input.file.uri, filename: input.file.name },
                ],
              }),
            ],
          }),
        )
        .pipe(
          Stream.filter(LLMEvent.is.textDelta),
          Stream.map((event) => event.text),
          Stream.mkString,
          Effect.catch(() => Effect.succeed("")),
        )
      const result = text.trim()
      if (result) cache.set(input.key, result)
      return result
    })

    const selectInfo = Effect.fn("SessionVision.selectInfo")(function* (current: ModelV2.Info) {
      const configured = Config.latest(yield* deps.config.entries(), "experimental")?.vision_model
      if (configured !== undefined) {
        const parsed = ModelV2.parse(configured)
        const override = yield* deps.catalog.model.get(parsed.providerID, parsed.modelID)
        if (override && override.status === "active" && supportsImages(override)) return override
      }
      // Only the selected model's own provider is used. Sending the user's image
      // to a different provider would be surprising, so no candidate means the
      // images are left untouched and the provider error surfaces unchanged.
      const candidates = (yield* deps.catalog.model.available()).filter(
        (model) =>
          model.providerID === current.providerID &&
          model.id !== current.id &&
          model.status === "active" &&
          supportsImages(model) &&
          SessionRunnerModel.supported(model),
      )
      return candidates.toSorted((a, b) => b.time.released - a.time.released)[0]
    })

    const bridge = Effect.fn("SessionVision.bridge")(function* (input: {
      session: SessionSchema.Info
      model: Model
      messages: ReadonlyArray<SessionMessage.Message>
    }) {
      const current = yield* deps.catalog.model.get(
        ProviderV2.ID.make(input.model.provider),
        ModelV2.ID.make(input.model.id),
      )
      if (!current || supportsImages(current)) return input.messages
      const images = input.messages.flatMap((message) =>
        message.type === "user"
          ? (message.files ?? [])
              .filter((file) => file.mime.startsWith("image/"))
              .map((file) => ({ message, file }))
          : [],
      )
      if (images.length === 0) return input.messages
      const info = yield* selectInfo(current)
      if (!info) return input.messages
      const visionModel = yield* deps.models.resolveInfo(input.session, info).pipe(
        Effect.catch(() => Effect.succeed(undefined)),
      )
      if (!visionModel) return input.messages
      const transcripts = yield* Effect.forEach(
        images,
        (item) =>
          transcribe({ key: `${item.message.id}:${item.file.uri}`, model: visionModel, file: item.file }).pipe(
            Effect.map((text) => ({ ...item, text })),
          ),
        { concurrency: 2 },
      )
      const byMessage = new Map<SessionMessage.ID, Array<{ file: FileAttachment; text: string }>>()
      for (const item of transcripts) {
        if (!item.text) continue
        const existing = byMessage.get(item.message.id) ?? []
        existing.push({ file: item.file, text: item.text })
        byMessage.set(item.message.id, existing)
      }
      if (byMessage.size === 0) return input.messages
      const now = yield* DateTime.now
      return input.messages.flatMap((message): ReadonlyArray<SessionMessage.Message> => {
        if (message.type !== "user") return [message]
        const items = byMessage.get(message.id)
        if (!items) return [message]
        const transcribed = new Set(items.map((item) => item.file.uri))
        const text = items
          .map((item) => `[Image${item.file.name === undefined ? "" : `: ${item.file.name}`}]\n${item.text}`)
          .join("\n\n")
        return [
          { ...message, files: (message.files ?? []).filter((file) => !transcribed.has(file.uri)) },
          SessionMessage.Synthetic.make({
            id: SessionMessage.ID.create(),
            sessionID: input.session.id,
            type: "synthetic",
            text,
            time: { created: now },
          }),
        ]
      })
    })

    return Service.of({ bridge })
  })

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const catalog = yield* Catalog.Service
    const models = yield* SessionRunnerModel.Service
    const llm = yield* LLMClient.Service
    const config = yield* Config.Service
    return yield* make({ catalog, models, config, stream: llm.stream })
  }),
)

export const node = makeLocationNode({
  service: Service,
  layer,
  deps: [Catalog.node, SessionRunnerModel.node, llmClient, Config.node],
})
