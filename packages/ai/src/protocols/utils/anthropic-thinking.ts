import type { LLMRequest, ReasoningPart } from "../../schema/messages.js"

const requireThinkingSignature = (request: LLMRequest) => {
  if (request.model.compatibility?.requireSignature !== undefined) return request.model.compatibility.requireSignature
  const provider = request.model.provider.toLowerCase()
  const model = request.model.id.toLowerCase()
  const baseURL = (request.model.route.endpoint.baseURL ?? "").toLowerCase()
  if (
    provider === "kimi-for-coding" ||
    provider === "moonshotai" ||
    provider === "moonshotai-cn" ||
    model.startsWith("kimi-") ||
    baseURL.includes("api.kimi.com/coding") ||
    baseURL.includes("api.moonshot.ai/anthropic") ||
    baseURL.includes("api.moonshot.cn/anthropic")
  )
    return false
  if (provider.includes("xiaomi") || model.includes("mimo") || baseURL.includes("xiaomimimo.com")) return false
  if (model.startsWith("qwen") || model.startsWith("minimax-")) return false
  return true
}

// Some stored reasoning disappears on replay. Both cache placement and message lowering need to know
// whether this part will send an assistant block and release pending system updates.
export const thinkingBlock = (request: LLMRequest, part: ReasoningPart) => {
  const metadata = part.providerMetadata?.[request.model.route.providerMetadataKey ?? request.model.provider]
  const signature = part.encrypted ?? (typeof metadata?.signature === "string" ? metadata.signature : undefined)
  if (signature === undefined && typeof metadata?.redactedData === "string")
    return { type: "redacted_thinking" as const, data: metadata.redactedData }
  if (signature?.trim()) return { type: "thinking" as const, thinking: part.text, signature }
  if (part.text.trim() && !requireThinkingSignature(request))
    return { type: "thinking" as const, thinking: part.text, signature: "" }
  return undefined
}
