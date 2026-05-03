import { isMedia } from "@/util/media"
import type { Provider } from "@/provider/provider"
import { Effect } from "effect"
import { convertToModelMessages, type ModelMessage, type ProviderMetadata, type UIMessage } from "ai"
import * as EffectLogger from "@opencode-ai/core/effect/logger"
import { SessionMessage } from "./session-message"
import { ID } from "./event"

export const SYNTHETIC_ATTACHMENT_PROMPT = "Attached image(s) from tool result:"

type Attachment = {
  mime: string
  url: string
  filename?: string
}

type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue | undefined }

function truncateToolOutput(text: string, maxChars?: number) {
  if (!maxChars || text.length <= maxChars) return text
  const omitted = text.length - maxChars
  return `${text.slice(0, maxChars)}\n[Tool output truncated for compaction: omitted ${omitted} chars]`
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function isJsonValue(value: unknown): value is JsonValue {
  if (value === null) return true
  if (typeof value === "boolean" || typeof value === "number" || typeof value === "string") return true
  if (Array.isArray(value)) return value.every(isJsonValue)
  if (isRecord(value)) return Object.values(value).every((item) => item === undefined || isJsonValue(item))
  return false
}

function outputText(content: SessionMessage.ToolStateCompleted["content"]) {
  return content
    .filter((item) => item.type === "text")
    .map((item) => item.text)
    .join("\n")
}

function outputAttachments(content: SessionMessage.ToolStateCompleted["content"]) {
  return content
    .filter((item) => item.type === "file")
    .map((item) => ({
      mime: item.mime,
      url: item.uri,
      filename: item.name,
    }))
}

function providerMeta(metadata: Record<string, unknown> | undefined) {
  if (!metadata) return undefined
  const result: ProviderMetadata = Object.fromEntries(
    Object.entries(metadata)
      .filter(([key]) => key !== "providerExecuted")
      .filter(
        (entry): entry is [string, Record<string, JsonValue | undefined>] =>
          isRecord(entry[1]) && Object.values(entry[1]).every((item) => item === undefined || isJsonValue(item)),
      ),
  )
  return Object.keys(result).length > 0 ? result : undefined
}

function toModelOutput(options: { output: unknown }) {
  if (typeof options.output === "string") return { type: "text", value: options.output }
  if (!isRecord(options.output)) return { type: "json", value: options.output as never }

  const attachments = Array.isArray(options.output.attachments)
    ? options.output.attachments.filter(
        (attachment): attachment is Attachment =>
          isRecord(attachment) && typeof attachment.mime === "string" && typeof attachment.url === "string",
      )
    : []
  const text = typeof options.output.text === "string" ? options.output.text : ""

  return {
    type: "content",
    value: [
      ...(text ? [{ type: "text" as const, text }] : []),
      ...attachments
        .filter((attachment) => attachment.url.startsWith("data:") && attachment.url.includes(","))
        .map((attachment) => ({
          type: "media" as const,
          mediaType: attachment.mime,
          data: attachment.url.slice(attachment.url.indexOf(",") + 1),
        })),
    ],
  }
}

function supportsMediaInToolResults(model: Provider.Model) {
  if (model.api.npm === "@ai-sdk/anthropic") return true
  if (model.api.npm === "@ai-sdk/openai") return true
  if (model.api.npm === "@ai-sdk/amazon-bedrock") return true
  if (model.api.npm === "@ai-sdk/google-vertex/anthropic") return true
  if (model.api.npm === "@ai-sdk/google") return model.api.id.toLowerCase().includes("gemini-3")
  return false
}

export const toModelMessagesEffect = Effect.fnUntraced(function* (
  input: SessionMessage.Message[],
  model: Provider.Model,
  options?: { stripMedia?: boolean; toolOutputMaxChars?: number },
) {
  const result: UIMessage[] = []
  const toolNames = new Set<string>()
  const supportsMedia = supportsMediaInToolResults(model)

  for (const msg of input) {
    if (msg.type === "user") {
      const parts: UIMessage["parts"] = []
      if (msg.text)
        parts.push({
          type: "text",
          text: msg.text,
        })
      for (const file of msg.files ?? []) {
        if (file.mime === "text/plain" || file.mime === "application/x-directory") continue
        if (options?.stripMedia && isMedia(file.mime)) {
          parts.push({
            type: "text",
            text: `[Attached ${file.mime}: ${file.name ?? "file"}]`,
          })
          continue
        }
        parts.push({
          type: "file",
          url: file.uri,
          mediaType: file.mime,
          filename: file.name,
        })
      }
      if (parts.length > 0) result.push({ id: msg.id, role: "user", parts })
    }

    if (msg.type === "synthetic" && msg.text) {
      result.push({
        id: msg.id,
        role: "user",
        parts: [{ type: "text", text: msg.text }],
      })
    }

    if (msg.type === "shell") {
      result.push({
        id: msg.id,
        role: "user",
        parts: [
          {
            type: "text",
            text: `The following shell command was executed by the user:\n\n${msg.command}${
              msg.output ? `\n\nOutput:\n${msg.output}` : ""
            }`,
          },
        ],
      })
    }

    if (msg.type === "compaction" && msg.summary) {
      result.push({
        id: `${msg.id}-summary`,
        role: "assistant",
        parts: [{ type: "text", text: msg.summary }],
      })
    }

    if (msg.type === "assistant") {
      const differentModel = `${model.providerID}/${model.id}` !== `${msg.model.providerID}/${msg.model.id}`
      if (msg.error && !msg.content.some((item) => item.type === "text" || item.type === "tool")) continue

      const parts: UIMessage["parts"] = []
      const media: Attachment[] = []
      for (const content of msg.content) {
        if (content.type === "text") {
          parts.push({ type: "text", text: content.text })
          continue
        }
        if (content.type === "reasoning") {
          if (differentModel) {
            if (content.text.trim().length > 0) parts.push({ type: "text", text: content.text })
            continue
          }
          parts.push({ type: "reasoning", text: content.text })
          continue
        }

        toolNames.add(content.name)
        if (content.state.status === "completed") {
          const output = content.time.pruned
            ? "[Old tool result content cleared]"
            : truncateToolOutput(outputText(content.state.content), options?.toolOutputMaxChars)
          const attachments =
            content.time.pruned || options?.stripMedia
              ? []
              : [
                  ...outputAttachments(content.state.content),
                  ...(content.state.attachments ?? []).map((attachment) => ({
                    mime: attachment.mime,
                    url: attachment.uri,
                    filename: attachment.name,
                  })),
                ]
          const mediaAttachments = attachments.filter((attachment) => isMedia(attachment.mime))
          if (!supportsMedia && mediaAttachments.length > 0) media.push(...mediaAttachments)
          const finalAttachments = supportsMedia
            ? attachments
            : attachments.filter((attachment) => !isMedia(attachment.mime))

          parts.push({
            type: `tool-${content.name}` as `tool-${string}`,
            state: "output-available",
            toolCallId: content.id,
            input: content.state.input,
            output: finalAttachments.length > 0 ? { text: output, attachments: finalAttachments } : output,
            ...(content.provider?.executed ? { providerExecuted: true } : {}),
            ...(differentModel ? {} : { callProviderMetadata: providerMeta(content.provider?.metadata) }),
          })
          continue
        }

        if (content.state.status === "error") {
          parts.push({
            type: `tool-${content.name}` as `tool-${string}`,
            state: "output-error",
            toolCallId: content.id,
            input: content.state.input,
            errorText: content.state.error.message,
            ...(content.provider?.executed ? { providerExecuted: true } : {}),
            ...(differentModel ? {} : { callProviderMetadata: providerMeta(content.provider?.metadata) }),
          })
          continue
        }

        parts.push({
          type: `tool-${content.name}` as `tool-${string}`,
          state: "output-error",
          toolCallId: content.id,
          input: content.state.status === "pending" ? {} : content.state.input,
          errorText: "[Tool execution was interrupted]",
          ...(content.provider?.executed ? { providerExecuted: true } : {}),
          ...(differentModel ? {} : { callProviderMetadata: providerMeta(content.provider?.metadata) }),
        })
      }

      if (parts.length > 0) {
        result.push({ id: msg.id, role: "assistant", parts })
        if (media.length > 0) {
          result.push({
            id: ID.create(),
            role: "user",
            parts: [
              { type: "text", text: SYNTHETIC_ATTACHMENT_PROMPT },
              ...media.map((attachment) => ({
                type: "file" as const,
                url: attachment.url,
                mediaType: attachment.mime,
                filename: attachment.filename,
              })),
            ],
          })
        }
      }
    }
  }

  return yield* Effect.promise(() =>
    convertToModelMessages(result, {
      // @ts-expect-error convertToModelMessages only needs tools[name]?.toModelOutput here.
      tools: Object.fromEntries(Array.from(toolNames).map((toolName) => [toolName, { toModelOutput }])),
    }),
  )
})

export function toModelMessages(
  input: SessionMessage.Message[],
  model: Provider.Model,
  options?: { stripMedia?: boolean; toolOutputMaxChars?: number },
): Promise<ModelMessage[]> {
  return Effect.runPromise(toModelMessagesEffect(input, model, options).pipe(Effect.provide(EffectLogger.layer)))
}

export * as SessionMessageModel from "./session-message-model"
