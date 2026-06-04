import { SessionMessage } from "@opencode-ai/core/session/message"
import type { JSONValue, SharedV3ProviderMetadata } from "@ai-sdk/provider"
import { DateTime } from "effect"
import { convertToModelMessages, type ModelMessage, type UIMessage } from "ai"

const PrunedToolOutput = "[Old tool result content cleared]"
const InterruptedToolOutput = "[Tool execution was interrupted]"

export async function toModelMessages(input: SessionMessage.Message[]): Promise<ModelMessage[]> {
  const toolNames = new Set<string>()
  const messages: UIMessage[] = []

  for (const message of chronological(input)) {
    if (message.type === "user") {
      const parts: UIMessage["parts"] = [
        ...(message.text === "" ? [] : [{ type: "text" as const, text: message.text }]),
        ...(message.files ?? []).map((file) => ({
          type: "file" as const,
          url: file.uri,
          mediaType: file.mime,
          filename: file.name,
        })),
      ]
      if (parts.length > 0) messages.push({ id: message.id, role: "user", parts })
      continue
    }

    if (message.type === "assistant") {
      if (message.error && !isAbortedAssistantWithContent(message)) continue

      const parts: UIMessage["parts"] = []
      for (const content of message.content) {
        if (content.type === "text") {
          // Provider metadata on assistant text is intentionally deferred for the
          // v2 migration slice; the canonical v2 text shape only carries text.
          parts.push({ type: "text", text: content.text })
          continue
        }

        if (content.type === "reasoning") {
          // Signed/provider reasoning metadata is intentionally deferred until a
          // first-class v2 schema field exists for it.
          parts.push({ type: "reasoning", text: content.text })
          continue
        }

        toolNames.add(content.name)
        parts.push(toolPart(content))
      }
      if (parts.length > 0) messages.push({ id: message.id, role: "assistant", parts })
    }
  }

  return await convertToModelMessages(messages, {
    // @ts-expect-error convertToModelMessages only needs tools[name]?.toModelOutput here.
    tools: Object.fromEntries(Array.from(toolNames).map((toolName) => [toolName, { toModelOutput }])),
  })
}

function chronological(input: SessionMessage.Message[]) {
  return input.slice().sort((left, right) => {
    const time = DateTime.toEpochMillis(left.time.created) - DateTime.toEpochMillis(right.time.created)
    if (time !== 0) return time
    if (left.id < right.id) return -1
    if (left.id > right.id) return 1
    return 0
  })
}

function isAbortedAssistantWithContent(message: SessionMessage.Assistant) {
  return message.error?.type === "aborted" && message.content.some(isMeaningfulAssistantContent)
}

function isMeaningfulAssistantContent(content: SessionMessage.AssistantContent) {
  if (content.type === "text") return content.text.trim().length > 0
  if (content.type === "tool") return true
  return false
}

function toolPart(content: SessionMessage.AssistantTool): UIMessage["parts"][number] {
  const metadata = providerMetadata(content.provider?.metadata)
  const base = {
    type: `tool-${content.name}` as `tool-${string}`,
    toolCallId: content.callID,
    input: content.state.input,
    ...(content.provider?.executed ? { providerExecuted: true } : {}),
    ...(metadata ? { callProviderMetadata: metadata } : {}),
  }

  if (content.state.status === "completed") {
    return {
      ...base,
      state: "output-available",
      output: content.time.pruned ? PrunedToolOutput : toolOutput(content.state.content),
    }
  }

  if (content.state.status === "error") {
    return {
      ...base,
      state: "output-error",
      errorText: content.state.error.message,
    }
  }

  return {
    ...base,
    state: "output-error",
    errorText: InterruptedToolOutput,
  }
}

function providerMetadata(input: Record<string, unknown> | undefined): SharedV3ProviderMetadata | undefined {
  if (!input) return undefined
  const entries = Object.entries(input).filter((entry): entry is [string, Record<string, JSONValue>] => {
    return isJSONObject(entry[1])
  })
  if (entries.length === 0) return undefined
  return Object.fromEntries(entries)
}

function isJSONObject(input: unknown): input is Record<string, JSONValue> {
  return Boolean(input && typeof input === "object" && !Array.isArray(input) && Object.values(input).every(isJSONValue))
}

function isJSONValue(input: unknown): input is JSONValue {
  if (input === null) return true
  if (typeof input === "string" || typeof input === "boolean") return true
  if (typeof input === "number") return Number.isFinite(input)
  if (Array.isArray(input)) return input.every(isJSONValue)
  return isJSONObject(input)
}

function toolOutput(content: SessionMessage.ToolStateCompleted["content"]) {
  const text = content
    .filter((item) => item.type === "text")
    .map((item) => item.text)
    .join("")
  const attachments = content
    .filter((item) => item.type === "file")
    .map((item) => ({ mime: item.mime, url: item.uri, filename: item.name }))

  if (attachments.length === 0) return text
  return { text, attachments }
}

function toModelOutput(options: { output: unknown }) {
  if (typeof options.output === "string") return { type: "text", value: options.output }
  if (isToolOutputWithAttachments(options.output)) {
    const attachments = options.output.attachments.filter((attachment) => {
      return attachment.url.startsWith("data:") && attachment.url.includes(",")
    })
    return {
      type: "content",
      value: [
        ...(options.output.text ? [{ type: "text" as const, text: options.output.text }] : []),
        ...attachments.map((attachment) => ({
          type: "media" as const,
          mediaType: attachment.mime,
          data: dataUrlPayload(attachment.url),
        })),
      ],
    }
  }
  return { type: "json", value: options.output as never }
}

function isToolOutputWithAttachments(input: unknown): input is {
  text: string
  attachments: Array<{ mime: string; url: string; filename?: string }>
} {
  return Boolean(
    input &&
      typeof input === "object" &&
      "text" in input &&
      "attachments" in input &&
      typeof input.text === "string" &&
      Array.isArray(input.attachments),
  )
}

function dataUrlPayload(input: string) {
  const comma = input.indexOf(",")
  if (comma === -1) return input
  return input.slice(comma + 1)
}

export * as MessageV2Model from "./message-v2-model"
