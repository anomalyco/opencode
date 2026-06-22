import { Provider } from "@/provider/provider"
import type { Config } from "@/config/config"
import type { Session } from "./session"
import type { SessionStatus } from "./status"
import { SessionV1 } from "@opencode-ai/core/v1/session"
import { PartID, SessionID, MessageID } from "./schema"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { ModelV2 } from "@opencode-ai/core/model"
import { generateText, type ModelMessage } from "ai"
import { Effect, Exit, Cause } from "effect"

export * as ImagePreprocess from "./image-preprocess"

const IMAGE_DESCRIBE_SYSTEM_PROMPT = `You are an image analysis assistant. Describe the provided image(s) in detail.

Rules:
- Focus on what is relevant to the user's question or intent
- Be specific: include text visible in the image, UI elements, code, colors, layout
- If the image shows code or terminal output, reproduce it as accurately as possible
- If the image shows a diagram or chart, describe the structure and relationships
- If there are multiple images, describe each one separately with a clear label
- Respond in the same language as the user's message
- Do not mention that you are describing an image
- Do not add disclaimers about your capabilities`

export const preprocessImages = Effect.fn("ImagePreprocess.preprocessImages")(
  function* (options: {
    sessionID: string
    message: SessionV1.WithParts
    imageModel?: { providerID: string; modelID: string }
    textParts: SessionV1.TextPart[]
    sessions: Session.Interface
    provider: Provider.Interface
    config: Config.Interface
    status: SessionStatus.Interface
  }) {
    const { sessionID, message, imageModel: explicitImageModel, textParts, sessions, provider, config, status } = options

    yield* Effect.logInfo("preprocessImages called", {
      sessionID,
      role: message.info.role,
      model: message.info.role === "user" ? message.info.model : undefined,
      explicitImageModel,
      partsCount: message.parts.length,
      partTypes: message.parts.map((p) => p.type),
    })

    if (explicitImageModel?.providerID === "__disabled__" && explicitImageModel?.modelID === "__disabled__") {
      yield* Effect.logInfo("image preprocessing is disabled by user, skipping")
      return message
    }

    if (message.info.role !== "user") return message
    const userModel = message.info.model
    if (!userModel) {
      yield* Effect.logInfo("no model ref on message, skipping image preprocess")
      return message
    }

    const currentModel = yield* Effect.exit(provider.getModel(userModel.providerID, userModel.modelID))
    if (Exit.isFailure(currentModel)) {
      yield* Effect.logWarning("failed to get current model, skipping image preprocess", {
        cause: Cause.squash(currentModel.cause),
      })
      return message
    }

    if (currentModel.value.capabilities.input?.image) {
      yield* Effect.logInfo("current model supports images, skipping preprocess")
      return message
    }

    const imageParts = message.parts.filter(
      (part): part is SessionV1.FilePart => part.type === "file" && part.mime.startsWith("image/"),
    )

    if (imageParts.length === 0) {
      yield* Effect.logInfo("no image parts found in message", { partTypes: message.parts.map((p) => p.type) })
      return message
    }

    yield* Effect.logInfo("found images to preprocess", { count: imageParts.length, sessionID })

    const resolvedImageModel = yield* Effect.gen(function* () {
      if (explicitImageModel) {
        const exit = yield* Effect.exit(
          provider.getModel(
            ProviderV2.ID.make(explicitImageModel.providerID),
            ModelV2.ID.make(explicitImageModel.modelID),
          ),
        )
        if (Exit.isSuccess(exit)) {
          yield* Effect.logInfo("using explicit image model", {
            model: `${explicitImageModel.providerID}/${explicitImageModel.modelID}`,
          })
          return exit.value
        }
      }

      const cfg = yield* config.get()
      if (cfg.image_model) {
        const parsed = Provider.parseModel(cfg.image_model)
        const exit = yield* Effect.exit(provider.getModel(parsed.providerID, parsed.modelID))
        if (Exit.isSuccess(exit)) {
          yield* Effect.logInfo("using config image model", { model: cfg.image_model })
          return exit.value
        }
      }

      const fallback = yield* provider.getImageModel()
      if (fallback) {
        const exit = yield* Effect.exit(provider.getModel(fallback.providerID, fallback.modelID))
        if (Exit.isSuccess(exit)) {
          yield* Effect.logInfo("using fallback image model", {
            model: `${fallback.providerID}/${fallback.modelID}`,
          })
          return exit.value
        }
      }

      return undefined
    })

    if (!resolvedImageModel) {
      yield* Effect.logWarning("no image model available, skipping preprocess")
      return message
    }

    if (!resolvedImageModel.capabilities.input?.image) {
      yield* Effect.logWarning("resolved image model does not support images", {
        model: `${resolvedImageModel.providerID}/${resolvedImageModel.id}`,
      })
      return message
    }

    const userText = textParts.map((p) => p.text).join("\n")

    const imageContent: Array<{ type: "text"; text: string } | { type: "image"; image: string }> = [
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

    const modelLabel = resolvedImageModel.name ?? `${resolvedImageModel.providerID}/${resolvedImageModel.id}`

    const languageExit = yield* Effect.exit(provider.getLanguage(resolvedImageModel))
    if (Exit.isFailure(languageExit)) {
      yield* Effect.logError("failed to get image model language client", {
        cause: Cause.squash(languageExit.cause),
      })
      return message
    }

    yield* status.set(SessionID.make(sessionID), { type: "image_processing", model: modelLabel })

    const description = yield* Effect.tryPromise(async () => {
      const result = await generateText({
        model: languageExit.value,
        system: IMAGE_DESCRIBE_SYSTEM_PROMPT,
        messages,
        maxOutputTokens: 4096,
      })
      return result.text
    }).pipe(
      Effect.tapError((err) => Effect.logError("image model call failed", { error: err })),
      Effect.catch(() => Effect.succeed(undefined as string | undefined)),
      Effect.ensuring(status.set(SessionID.make(sessionID), { type: "busy" })),
    )

    if (!description) {
      yield* Effect.logWarning("image model returned empty description, keeping original parts")
      return message
    }

    yield* Effect.logInfo("image model returned description", { length: description.length })

    const brandedSessionID = SessionID.make(sessionID)
    const brandedMessageID = MessageID.make(message.info.id)

    for (const part of imageParts) {
      yield* sessions.removePart({ sessionID: brandedSessionID, messageID: brandedMessageID, partID: part.id })
    }

    const syntheticPart: SessionV1.TextPart = {
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
