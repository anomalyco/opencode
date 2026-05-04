import { Log } from "@/util"
import { Provider } from "@/provider"
import type { Config } from "@/config"
import type { Session } from "@/session"
import type { SessionStatus } from "@/session/status"
import { MessageV2 } from "@/session/message-v2"
import { PartID, SessionID, MessageID } from "@/session/schema"
import { ProviderID, ModelID } from "@/provider/schema"
import { generateText, type ModelMessage } from "ai"
import { Effect, Exit, Cause } from "effect"
import { Agent } from "@/agent/agent"

const log = Log.create({ service: "image-preprocess" })

export * as ImagePreprocess from "./image-preprocess"

export const preprocessImages = Effect.fn("ImagePreprocess.preprocessImages")(
  function* (options: {
    sessionID: string
    message: MessageV2.WithParts
    imageModel?: { providerID: string; modelID: string }
    textParts: MessageV2.TextPart[]
    sessions: Session.Interface
    provider: Provider.Interface
    config: Config.Interface
    status: SessionStatus.Interface
  }) {
    const { sessionID, message, imageModel: explicitImageModel, textParts, sessions, provider, config, status } = options

    if (message.info.role !== "user") return message
    const userModel = message.info.model
    if (!userModel) {
      log.info("no model ref on message, skipping image preprocess")
      return message
    }

    const currentModel = yield* Effect.exit(provider.getModel(userModel.providerID, userModel.modelID))
    if (Exit.isFailure(currentModel)) {
      log.warn("failed to get current model, skipping image preprocess", { cause: Cause.squash(currentModel.cause) })
      return message
    }

    if (currentModel.value.capabilities.input?.image) {
      log.info("current model supports images, skipping preprocess")
      return message
    }

    const imageParts = message.parts.filter(
      (part): part is MessageV2.FilePart => part.type === "file" && part.mime.startsWith("image/"),
    )

    if (imageParts.length === 0) return message

    log.info("found images to preprocess", { count: imageParts.length, sessionID })

    const resolvedImageModel = yield* Effect.gen(function* () {
      if (explicitImageModel) {
        const exit = yield* Effect.exit(
          provider.getModel(
            ProviderID.make(explicitImageModel.providerID),
            ModelID.make(explicitImageModel.modelID),
          ),
        )
        if (Exit.isSuccess(exit)) {
          log.info("using explicit image model", { model: `${explicitImageModel.providerID}/${explicitImageModel.modelID}` })
          return exit.value
        }
      }

      const cfg = yield* config.get()
      if (cfg.image_model) {
        const parsed = Provider.parseModel(cfg.image_model)
        const exit = yield* Effect.exit(provider.getModel(parsed.providerID, parsed.modelID))
        if (Exit.isSuccess(exit)) {
          log.info("using config image model", { model: cfg.image_model })
          return exit.value
        }
      }

      const fallback = yield* provider.getImageModel()
      if (fallback) {
        const exit = yield* Effect.exit(provider.getModel(fallback.providerID, fallback.modelID))
        if (Exit.isSuccess(exit)) {
          log.info("using fallback image model", { model: `${fallback.providerID}/${fallback.modelID}` })
          return exit.value
        }
      }

      return undefined
    })

    if (!resolvedImageModel) {
      log.warn("no image model available, skipping preprocess")
      return message
    }

    if (!resolvedImageModel.capabilities.input?.image) {
      log.warn("resolved image model does not support images", { model: `${resolvedImageModel.providerID}/${resolvedImageModel.id}` })
      return message
    }

    const userText = textParts.map((p) => p.text).join("\n")

    const imageContent: ModelMessage["content"] = [
      ...(userText ? [{ type: "text" as const, text: userText }] : []),
      ...imageParts.map((part) => ({
        type: "image" as const,
        image: part.url,
      })),
    ]

    const messages: ModelMessage[] = [
      {
        role: "user",
        content: imageContent,
      },
    ]

    const language = yield* provider.getLanguage(resolvedImageModel)

    const modelLabel = resolvedImageModel.name ?? `${resolvedImageModel.providerID}/${resolvedImageModel.id}`

    yield* status.set(SessionID.make(sessionID), { type: "image_processing", model: modelLabel })

    const description = yield* Effect.promise(async () => {
      const result = await generateText({
        model: language,
        system: Agent.PROMPT_IMAGE_DESCRIBE,
        messages,
        maxOutputTokens: 4096,
      })
      return result.text
    }).pipe(
      Effect.tapError((err) => Effect.sync(() => log.error("image model call failed", { error: err }))),
      Effect.catch(() => Effect.succeed(undefined as string | undefined)),
      Effect.ensuring(status.set(SessionID.make(sessionID), { type: "busy" })),
    )

    if (!description) {
      log.warn("image model returned empty description, keeping original parts")
      return message
    }

    log.info("image model returned description", { length: description.length })

    const brandedSessionID = SessionID.make(sessionID)
    const brandedMessageID = MessageID.make(message.info.id)

    for (const part of imageParts) {
      yield* sessions.removePart({ sessionID: brandedSessionID, messageID: brandedMessageID, partID: part.id })
    }

    const syntheticPart: MessageV2.TextPart = {
      id: PartID.ascending(),
      sessionID: brandedSessionID,
      messageID: brandedMessageID,
      type: "text",
      text: description,
      synthetic: true,
    }

    yield* sessions.updatePart(syntheticPart)

    const remainingParts = message.parts.filter((part) => part.type !== "file" || !part.mime.startsWith("image/"))

    return {
      info: message.info,
      parts: [...remainingParts, syntheticPart],
    }
  },
)
