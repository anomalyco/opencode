import type { Provider } from "@/provider/provider"
import type { MessageV2 } from "./message-v2"

export namespace OpenAIConversationState {
  export function isGPTModel(model: Provider.Model): boolean {
    if (model.providerID !== "openai") return false
    if (!model.api?.id) return false
    return model.api.id.toLowerCase().includes("gpt")
  }

  export function extractResponseId(metadata: unknown): string | undefined {
    if (!metadata || typeof metadata !== "object") return undefined
    const openai = (metadata as any).openai
    if (!openai || typeof openai !== "object") return undefined
    const responseId = (openai as any).responseId ?? (openai as any).response_id
    return typeof responseId === "string" && responseId.length > 0 ? responseId : undefined
  }

  export function latestResponseId(messages: MessageV2.WithParts[]): string | undefined {
    for (let msgIndex = messages.length - 1; msgIndex >= 0; msgIndex--) {
      const msg = messages[msgIndex]
      for (let partIndex = msg.parts.length - 1; partIndex >= 0; partIndex--) {
        const part: any = msg.parts[partIndex]
        const id = extractResponseId(part?.metadata)
        if (id) return id
      }
    }
    return undefined
  }

  export function stripResponseIdFromMetadata(metadata: unknown): Record<string, any> | undefined {
    if (!metadata || typeof metadata !== "object") return undefined
    const record = metadata as Record<string, any>
    if (!record.openai || typeof record.openai !== "object") return record

    const next = { ...record }
    const openai = { ...next.openai }
    delete openai.responseId
    delete openai.response_id
    if (Object.keys(openai).length === 0) {
      delete next.openai
    } else {
      next.openai = openai
    }
    return Object.keys(next).length === 0 ? undefined : next
  }

  export function stripResponseIdFromPart<T extends MessageV2.Part>(part: T): T {
    if (!("metadata" in part)) return part
    const nextMetadata = stripResponseIdFromMetadata((part as any).metadata)
    if (nextMetadata === (part as any).metadata) return part
    return {
      ...(part as any),
      ...(nextMetadata ? { metadata: nextMetadata } : { metadata: undefined }),
    }
  }
}

