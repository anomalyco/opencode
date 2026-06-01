import type { Message, Part } from "@opencode-ai/sdk/v2/client"

export type SessionContextRawDerived = {
  providerMetadata: Record<string, unknown>
  serviceTier?: string
}

export function getSessionContextRawDerived(
  message: Message,
  parts: Part[],
): SessionContextRawDerived | undefined {
  if (message.role !== "assistant") return

  const providerMetadata = stepFinishMetadata(parts) ?? latestPartMetadata(parts)
  if (!providerMetadata) return

  const serviceTier = serviceTierForProvider(message.providerID, providerMetadata)
  if (serviceTier === undefined) return { providerMetadata }
  return { providerMetadata, serviceTier }
}

export function formatSessionContextRaw(message: Message, parts: Part[]) {
  const derived = getSessionContextRawDerived(message, parts)
  return JSON.stringify(
    {
      message,
      ...(derived?.serviceTier ? { serviceTier: derived.serviceTier } : {}),
      ...(derived?.providerMetadata ? { providerMetadata: derived.providerMetadata } : {}),
      parts,
    },
    omitLargeReasoningFields,
    2,
  )
}

function stepFinishMetadata(parts: Part[]) {
  for (let i = parts.length - 1; i >= 0; i--) {
    const part = parts[i]
    if (part.type !== "step-finish") continue
    if (!isRecord(part.metadata)) continue
    return part.metadata
  }
}

function latestPartMetadata(parts: Part[]) {
  for (let i = parts.length - 1; i >= 0; i--) {
    const metadata = partMetadata(parts[i])
    if (!metadata) continue
    const { providerExecuted: _, ...rest } = metadata
    if (Object.keys(rest).length > 0) return rest
  }
}

function partMetadata(part: Part) {
  if (!("metadata" in part)) return
  if (!isRecord(part.metadata)) return
  return part.metadata
}

function serviceTierForProvider(providerID: string, providerMetadata: Record<string, unknown>) {
  const info = providerMetadata[providerID]
  if (!isRecord(info)) return
  if (typeof info.serviceTier !== "string") return
  return info.serviceTier
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function omitLargeReasoningFields(key: string, value: unknown) {
  if (key === "reasoningEncryptedContent") return undefined
  return value
}
