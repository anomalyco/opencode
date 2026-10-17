export * as SessionVision from "./vision.js"

import { LLMClient, LLMEvent, Media, Message } from "@opencode/ai"
import type { Agent } from "@opencode/schema/agent"
import type { FileAttachment } from "@opencode/schema/prompt"
import { Clock, Context, DateTime, Effect, Layer, Stream } from "effect"
import { Bus } from "../bus.js"
import { Config } from "../config.js"
import { llmClient } from "../effect/app-node-platform.js"
import { makeLocationNode } from "@opencode/util/effect/app-node"
import { SessionEvent } from "./event.js"
import { SessionMessage } from "./message.js"
import { SessionModelRequest } from "./model-request.js"
import { Model } from "../model.js"
import { Provider } from "../provider.js"
import { SessionRunnerModel } from "./runner/model.js"
import { SessionSchema } from "./schema.js"
import { SessionUsage } from "./usage.js"

const TRANSCRIBE_INSTRUCTION = `Describe this image for a developer who cannot see it.
Transcribe all visible text verbatim, including code, error messages, terminal output, and UI labels.
If there is little or no text, describe the visual content instead: layout, components, colors, and anything a developer would need to understand it.`

// Transcripts are keyed by message and file position so a multi-step turn only
// pays for each image once. `null` marks a failed or empty transcription so a
// broken or rate-limited vision model is not retried on every later step.
const CACHE_LIMIT = 256

export interface Dependencies {
  /** Resolves the configured transcription model, or undefined when transcription is not available. */
  readonly visionModel: (session: SessionSchema.Info) => Effect.Effect<SessionRunnerModel.Resolved | undefined>
  /** Runs one transcription request. Returns undefined when the request failed. */
  readonly transcribe: (input: {
    readonly session: SessionSchema.Info
    readonly agent: Agent.ID
    readonly model: SessionRunnerModel.Resolved
    readonly file: FileAttachment
  }) => Effect.Effect<string | undefined, never>
}

export interface Interface {
  readonly bridge: (input: {
    readonly session: SessionSchema.Info
    readonly agent: Agent.ID
    readonly model: SessionRunnerModel.Resolved
    readonly messages: ReadonlyArray<SessionMessage.Info>
  }) => Effect.Effect<ReadonlyArray<SessionMessage.Info>>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/SessionVision") {}

const bridge = (deps: Dependencies) => {
  const cache = new Map<string, string | null>()
  const remember = (key: string, value: string | null) => {
    if (cache.size >= CACHE_LIMIT) {
      const oldest = cache.keys().next()
      if (oldest.done !== true) cache.delete(oldest.value)
    }
    cache.set(key, value)
  }
  const service: Interface = {
    bridge: Effect.fn("SessionVision.bridge")(function* (input: Parameters<Interface["bridge"]>[0]) {
      const vision = yield* deps.visionModel(input.session)
      if (!vision) return input.messages
      if (input.model.capabilities.input.some((modality) => modality.startsWith("image"))) return input.messages
      const images = input.messages.flatMap((message) =>
        message.type === "user"
          ? (message.files ?? []).flatMap((file, index) =>
              file.mime.startsWith("image/") ? [{ message, file, index }] : [],
            )
          : [],
      )
      if (images.length === 0) return input.messages
      const transcripts = yield* Effect.forEach(
        images,
        (item) => {
          const key = `${item.message.id}:${item.index}`
          const cached = cache.get(key)
          if (cached !== undefined) return Effect.succeed({ ...item, text: cached ?? undefined })
          return deps
            .transcribe({ session: input.session, agent: input.agent, model: vision, file: item.file })
            .pipe(
              Effect.flatMap((text) =>
                Effect.gen(function* () {
                  const transcript = text?.trim()
                  if (transcript) {
                    remember(key, transcript)
                    return { ...item, text: transcript }
                  }
                  remember(key, null)
                  yield* Effect.logWarning("image transcription returned no text", {
                    sessionID: input.session.id,
                    visionModel: vision.ref,
                  })
                  return { ...item, text: undefined }
                }),
              ),
              Effect.catch(() =>
                Effect.gen(function* () {
                  remember(key, null)
                  yield* Effect.logWarning("image transcription request failed", {
                    sessionID: input.session.id,
                    visionModel: vision.ref,
                  })
                  return { ...item, text: undefined }
                }),
              ),
            )
        },
        { concurrency: 2 },
      )
      const byMessage = new Map<SessionMessage.ID, Array<{ index: number; file: FileAttachment; text: string }>>()
      for (const item of transcripts) {
        if (item.text === undefined) continue
        const existing = byMessage.get(item.message.id) ?? []
        existing.push({ index: item.index, file: item.file, text: item.text })
        byMessage.set(item.message.id, existing)
      }
      if (byMessage.size === 0) return input.messages
      const now = DateTime.makeUnsafe(yield* Clock.currentTimeMillis)
      return input.messages.flatMap((message): ReadonlyArray<SessionMessage.Info> => {
        if (message.type !== "user") return [message]
        const items = byMessage.get(message.id)
        if (!items) return [message]
        const transcribed = new Set(items.map((item) => item.index))
        const text = items
          .map((item) => `[Image${item.file.name === undefined ? "" : `: ${item.file.name}`}]\n${item.text}`)
          .join("\n\n")
        return [
          { ...message, files: (message.files ?? []).filter((_, index) => !transcribed.has(index)) },
          SessionMessage.Synthetic.make({
            id: SessionMessage.ID.create(),
            text,
            type: "synthetic",
            time: { created: now },
          }),
        ]
      })
    }),
  }
  return Service.of(service)
}

/** Test or embedding seam for supplying model selection and transcription directly. */
export const layerWith = (deps: Dependencies) => Layer.succeed(Service, bridge(deps))

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const bus = yield* Bus.Service
    const config = yield* Config.Service
    const catalog = yield* Model.Service
    const llm = yield* LLMClient.Service
    const requests = yield* SessionModelRequest.Service
    const resolver = yield* SessionRunnerModel.Service

    const visionModel = Effect.fn("SessionVision.visionModel")(function* (session: SessionSchema.Info) {
      const configured = Config.latest(yield* config.entries(), "experimental")?.vision_model
      // Opt-in: images are only sent to the model the user explicitly configured.
      if (configured === undefined) return undefined
      if (!/^[^/#]+\/[^#]+$/.test(configured)) {
        yield* Effect.logWarning("experimental.vision_model must be provider/model", { vision_model: configured })
        return undefined
      }
      const separator = configured.indexOf("/")
      const info = yield* catalog.get(
        Provider.ID.make(configured.slice(0, separator)),
        Model.ID.make(configured.slice(separator + 1)),
      )
      if (!info || !info.capabilities.input.some((modality) => modality.startsWith("image"))) return undefined
      return yield* resolver
        .resolve({ ...session, model: Model.Ref.make({ providerID: info.providerID, id: info.id }) }, catalog.available)
        .pipe(Effect.orElseSucceed(() => undefined))
    })

    const transcribe = Effect.fn("SessionVision.transcribe")(function* (input: {
      session: SessionSchema.Info
      agent: Agent.ID
      model: SessionRunnerModel.Resolved
      file: FileAttachment
    }) {
      const chunks: string[] = []
      let usage: SessionUsage.Recorded | undefined
      const recordUsage = Effect.suspend(() =>
        usage
          ? bus
              .publish(SessionEvent.UsageRecorded, {
                sessionID: input.session.id,
                source: "vision",
                ...usage,
              })
              .pipe(Effect.ignore)
          : Effect.void,
      )
      const prepared = yield* requests.generate({
        session: input.session,
        agent: input.agent,
        model: input.model,
        system: [],
        messages: [
          Message.user([
            Message.text(TRANSCRIBE_INSTRUCTION),
            Message.media(Media.base64(input.file.data, input.file.mime), { filename: input.file.name }),
          ]),
        ],
      })
      const text = yield* llm.stream(prepared.request, prepared.options).pipe(
        Stream.runForEach((event) => {
          if (LLMEvent.is.textDelta(event)) chunks.push(event.text)
          if (LLMEvent.is.stepFinish(event)) {
            const step = SessionUsage.record(event.usage, input.model.cost)
            usage = usage ? SessionUsage.add(usage, step) : step
          }
          return Effect.void
        }),
        Effect.catchTag("AI.Error", (error) =>
          Effect.gen(function* () {
            yield* Effect.logWarning("image transcription request failed", {
              sessionID: input.session.id,
              visionModel: input.model.ref,
              cause: error.message,
            })
            return Effect.succeed(undefined)
          }),
        ),
        Effect.onInterrupt(() => recordUsage.pipe(Effect.asVoid)),
      )
      yield* recordUsage
      return text === undefined ? undefined : chunks.join("")
    })

    return Service.of(bridge({ visionModel, transcribe }))
  }),
)

export const node = makeLocationNode({
  service: Service,
  layer,
  deps: [Bus.node, Config.node, Model.node, SessionModelRequest.node, SessionRunnerModel.node, llmClient],
})