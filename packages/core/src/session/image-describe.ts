export * as SessionImageDescribe from "./image-describe.js"

import {
  ai,
  AssistantMessage,
  Media,
  LLMClient,
  Message,
  ToolMessage,
  UserMessage,
  type LLMRequest,
  type MediaPart,
  type ToolResultPart,
} from "@opencode/ai/effect"
import { type Capabilities, Model } from "../model.js"
import { Config } from "../config.js"
import { Effect, Exit, Layer, Context } from "effect"
import { createHash } from "node:crypto"
import { Flag } from "../flag.js"
import { llmClient } from "../effect/app-node-platform.js"
import { makeLocationNode } from "@opencode/util/effect/app-node"
import { ModelResolver } from "../model-resolver.js"
import { ModelRetry } from "../model-retry.js"
import { Provider } from "../provider.js"
import type { Content } from "@opencode/schema/tool"

const DESCRIBE_SYSTEM = `You are an image analysis assistant. Describe the provided image in detail for a text-only assistant that cannot see it.

Rules:
- Focus on what is relevant to the user's question or intent
- Be specific: include text visible in the image, UI elements, code, colors, layout
- If the image shows code or terminal output, reproduce it as accurately as possible
- If the image shows a diagram or chart, describe the structure and relationships
- Respond in the same language as the user's message
- Do not mention that you are describing an image or add disclaimers about your capabilities`

export interface Interface {
  /**
   * Replaces image media a model cannot see with text descriptions from a vision-capable model. Images the
   * describer cannot serve are left in place so `unsupportedParts` keeps its error placeholder for them.
   */
  readonly substitute: (
    messages: LLMRequest["messages"],
    target: { readonly capabilities: Capabilities; readonly providerID: Provider.ID },
  ) => Effect.Effect<LLMRequest["messages"]>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/SessionImageDescribe") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const config = yield* Config.Service
    const models = yield* Model.Service
    const resolver = yield* ModelResolver.Service
    const llm = yield* LLMClient.Service
    // Descriptions survive every later step and restart-free process lifetime; the key covers the describing
    // model, so a different describer re-describes instead of serving another model's wording.
    const descriptions = new Map<string, string>()

    const describer = Effect.fn("SessionImageDescribe.describer")(function* (providerID: Provider.ID) {
      const selection = Config.latest(yield* config.entries(), "experimental")?.image_model
      if (selection !== undefined) {
        const configured = yield* models.get(selection.providerID, selection.model)
        if (configured?.enabled && configured.capabilities.input.some((item) => item.startsWith("image")))
          return { info: configured, variant: selection.variant }
        yield* Effect.logWarning("experimental.image_model cannot describe images; selecting automatically", {
          model: `${selection.providerID}/${selection.model}`,
        })
      }
      const automatic = yield* models.image(providerID)
      return automatic && { info: automatic, variant: undefined }
    })

    const describe = Effect.fn("SessionImageDescribe.describe")(function* (
      resolved: ModelResolver.Resolved,
      media: MediaPart["media"],
      name: string | undefined,
      context: string | undefined,
    ) {
      const inline = media.inline()
      if (inline === undefined) return undefined
      const key = `${resolved.ref.providerID}/${resolved.ref.id}:${inline.mime}:${createHash("sha256").update(inline.base64).digest("hex")}`
      const cached = descriptions.get(key)
      if (cached !== undefined) return cached
      const result = yield* Effect.exit(
        llm
          .generate(
            ai.request({
              model: resolved.model,
              system: DESCRIBE_SYSTEM,
              messages: [
                Message.user([
                  Message.text(
                    [
                      name === undefined ? undefined : `The image's file name is "${name}".`,
                      context === undefined || context === "" ? undefined : `For context, the user's message reads:\n${context}`,
                    ]
                      .filter((line) => line !== undefined)
                      .join("\n") || "Describe the image.",
                  ),
                  { type: "media" as const, media, ...(name === undefined ? {} : { filename: name }) },
                ]),
              ],
            }),
          )
          .pipe(ModelRetry.retryOneShot),
      )
      if (Exit.isFailure(result)) {
        yield* Effect.logWarning("image description failed; keeping the unsupported-image placeholder", {
          model: `${resolved.ref.providerID}/${resolved.ref.id}`,
          cause: result.cause,
        })
        return undefined
      }
      const description = result.value.text
      if (description === "") return undefined
      descriptions.set(key, description)
      return description
    })

    const substitute = Effect.fn("SessionImageDescribe.substitute")(function* (
      messages: LLMRequest["messages"],
      target: { readonly capabilities: Capabilities; readonly providerID: Provider.ID },
    ) {
      if (!(yield* Flag.enabled("image_fallback"))) return messages
      if (target.capabilities.input.some((item) => item.startsWith("image"))) return messages
      if (!hasImages(messages)) return messages
      const selection = yield* describer(target.providerID)
      if (selection === undefined) {
        yield* Effect.logDebug("no image-capable model available to describe images for this session")
        return messages
      }
      const resolved = yield* Effect.exit(resolver.resolveModel(selection.info, selection.variant))
      if (Exit.isFailure(resolved)) {
        yield* Effect.logWarning("could not initialize the image-describing model", {
          model: `${selection.info.providerID}/${selection.info.id}`,
          cause: resolved.cause,
        })
        return messages
      }

      const replacement = (name: string | undefined, description: string) =>
        `[Image${name === undefined ? "" : ` "${name}"`} converted to text by ${resolved.value.ref.providerID}/${resolved.value.ref.id} because the active model cannot see images]\n${description}`

      // Tool-result files carry data URLs; remote URIs have no local payload to describe.
      const filePayload = (item: Extract<Content, { type: "file" }>) => {
        const comma = item.uri.indexOf(",")
        if (!item.uri.startsWith("data:") || comma === -1) return undefined
        if (!item.uri.slice(5, comma).split(";").includes("base64")) return undefined
        return { media: Media.base64(item.uri.slice(comma + 1), item.mime), name: item.name }
      }

      let changed = false
      const next = yield* Effect.forEach(messages, (message) =>
        Effect.gen(function* () {
          if (message.role === "user") {
            const context = message.content
              .flatMap((part) => (part.type === "text" ? [part.text] : []))
              .join("\n")
            const content = yield* Effect.forEach(message.content, (part) =>
              Effect.gen(function* () {
                if (part.type !== "media" || !part.media.mediaType.toLowerCase().startsWith("image/")) return part
                const description = yield* describe(resolved.value, part.media, part.filename, context)
                if (description === undefined) return part
                changed = true
                return Message.text(replacement(part.filename, description))
              }),
            )
            return content.every((part, index) => part === message.content[index])
              ? message
              : new UserMessage({ ...message, content })
          }
          if (message.role === "assistant") {
            const content = yield* Effect.forEach(message.content, (part) =>
              Effect.gen(function* () {
                if (part.type !== "media" || !part.media.mediaType.toLowerCase().startsWith("image/")) return part
                const description = yield* describe(resolved.value, part.media, part.filename, undefined)
                if (description === undefined) return part
                changed = true
                return Message.text(replacement(part.filename, description))
              }),
            )
            return content.every((part, index) => part === message.content[index])
              ? message
              : new AssistantMessage({ ...message, content })
          }
          if (message.role !== "tool") return message
          const content = yield* Effect.forEach(message.content, (part: ToolResultPart) =>
            Effect.gen(function* () {
              if (part.result.type !== "content") return part
              const result = part.result
              const value = yield* Effect.forEach(result.value, (item: Content) =>
                Effect.gen(function* () {
                  if (item.type !== "file" || !item.mime.startsWith("image/")) return item
                  const payload = filePayload(item)
                  if (payload === undefined) return item
                  const description = yield* describe(resolved.value, payload.media, payload.name, undefined)
                  if (description === undefined) return item
                  changed = true
                  return { type: "text" as const, text: replacement(payload.name, description) }
                }),
              )
              return value.every((item, index) => item === result.value[index])
                ? part
                : { ...part, result: { ...result, value } }
            }),
          )
          return new ToolMessage({ ...message, content })
        }),
      )
      return changed ? next : messages
    })

    return Service.of({ substitute })
  }),
)

/** Any locally-payloaded image in the transcript, including tool results, is worth resolving a describer for. */
function hasImages(messages: LLMRequest["messages"]) {
  return messages.some((message) => {
    if (message.role === "user" || message.role === "assistant")
      return message.content.some(
        (part) => part.type === "media" && part.media.mediaType.toLowerCase().startsWith("image/"),
      )
    if (message.role !== "tool") return false
    return message.content.some(
      (part) =>
        part.result.type === "content" && part.result.value.some((item) => item.type === "file" && item.mime.startsWith("image/")),
    )
  })
}

export const node = makeLocationNode({
  service: Service,
  layer,
  deps: [Config.node, Model.node, ModelResolver.node, llmClient],
})
