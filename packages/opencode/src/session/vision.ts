import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { SessionV1 } from "@opencode-ai/core/v1/session"
import { Context, Effect, Layer } from "effect"
import * as Stream from "effect/Stream"
import { convertToModelMessages, type UIMessage } from "ai"
import { LLMEvent } from "@opencode-ai/llm"
import { Provider } from "@/provider/provider"
import { Config } from "@/config/config"
import { Agent } from "@/agent/agent"
import { isImageAttachment } from "@/util/media"
import { LLM } from "./llm"

const TRANSCRIBE_INSTRUCTION = `Transcribe every piece of text visible in this image, preserving order and structure.
Include code, error messages, terminal output, and UI labels verbatim.
Output only the transcription, with no commentary or summary.`

const TRANSCRIBE_AGENT: Agent.Info = {
  name: "vision",
  mode: "primary",
  permission: [],
  options: {},
  prompt: "You convert images into faithful text. Never summarize or omit content.",
}

function supportsVision(model: Provider.Model) {
  return model.capabilities.input.image
}

function imageParts(messages: SessionV1.WithParts[]) {
  return messages.flatMap((message) =>
    message.info.role === "user"
      ? message.parts.filter((part): part is SessionV1.FilePart => part.type === "file" && isImageAttachment(part.mime))
      : [],
  )
}

export interface Interface {
  readonly bridge: (input: {
    messages: SessionV1.WithParts[]
    model: Provider.Model
    user: SessionV1.User
  }) => Effect.Effect<SessionV1.WithParts[]>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/SessionVision") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const provider = yield* Provider.Service
    const config = yield* Config.Service
    const llm = yield* LLM.Service
    // Transcripts are keyed by part id so a multi-step session only pays for
    // each image once. Part ids are globally unique, so one map is safe here.
    const cache = new Map<string, string>()

    const transcribe = Effect.fnUntraced(function* (input: {
      part: SessionV1.FilePart
      model: Provider.Model
      user: SessionV1.User
    }) {
      const cached = cache.get(input.part.id)
      if (cached !== undefined) return cached
      const message: Omit<UIMessage, "id"> = {
        role: "user",
        parts: [
          { type: "text", text: TRANSCRIBE_INSTRUCTION },
          { type: "file", mediaType: input.part.mime, filename: input.part.filename, url: input.part.url },
        ],
      }
      const messages = yield* Effect.promise(() => convertToModelMessages([message]))
      const text = yield* llm
        .stream({
          user: input.user,
          sessionID: input.user.sessionID,
          model: input.model,
          agent: TRANSCRIBE_AGENT,
          system: [],
          small: true,
          tools: {},
          retries: 1,
          messages,
        })
        .pipe(
          Stream.filter(LLMEvent.is.textDelta),
          Stream.map((event) => event.text),
          Stream.mkString,
        )
        .pipe(Effect.catch(() => Effect.succeed("")))
      const result = text.trim()
      if (result) cache.set(input.part.id, result)
      return result
    })

    const selectModel = Effect.fnUntraced(function* (current: Provider.Model) {
      const override = (yield* config.get()).experimental?.vision_model
      if (override) {
        const parsed = Provider.parseModel(override)
        const model = yield* provider
          .getModel(parsed.providerID, parsed.modelID)
          .pipe(Effect.catch(() => Effect.succeed(undefined)))
        if (model && supportsVision(model)) return model
      }

      const providers = yield* provider.list()
      const candidates = Object.values(providers).flatMap((info) =>
        Object.values(info.models).filter((model) => model.status === "active" && supportsVision(model)),
      )
      // Only the selected model's own provider is used. Sending the user's image
      // to a different provider would be surprising, so OCR (opt-in) is the only
      // cross-provider-safe fallback.
      return candidates
        .filter((model) => model.providerID === current.providerID && model.id !== current.id)
        .toSorted((a, b) => b.release_date.localeCompare(a.release_date))[0]
    })

    const bridge = Effect.fn("SessionVision.bridge")(function* (input: {
      messages: SessionV1.WithParts[]
      model: Provider.Model
      user: SessionV1.User
    }) {
      if (supportsVision(input.model)) return input.messages
      const parts = imageParts(input.messages)
      if (parts.length === 0) return input.messages

      const visionModel = yield* selectModel(input.model)
      if (!visionModel) return input.messages

      const transcripts = yield* Effect.forEach(
        parts,
        (part) =>
          transcribe({ part, model: visionModel, user: input.user }).pipe(
            Effect.map((text) => ({ id: part.id, text })),
          ),
        { concurrency: 2 },
      )
      const byID = new Map(transcripts.filter((item) => item.text).map((item) => [item.id, item.text]))
      if (byID.size === 0) return input.messages

      return input.messages.map((message) => ({
        info: message.info,
        parts: message.parts.map((part): SessionV1.Part => {
          if (part.type !== "file") return part
          const text = byID.get(part.id)
          if (!text) return part
          return {
            id: part.id,
            sessionID: part.sessionID,
            messageID: part.messageID,
            type: "text",
            text: `[Image${part.filename ? `: ${part.filename}` : ""}]\n${text}`,
            synthetic: true,
          }
        }),
      }))
    })

    return Service.of({ bridge })
  }),
)

export const node = LayerNode.make({
  service: Service,
  layer,
  deps: [Provider.node, Config.node, LLM.node],
})

export * as SessionVision from "./vision"
