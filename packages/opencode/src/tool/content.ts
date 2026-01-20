import type { MessageV2 } from "../session/message-v2"
import { Identifier } from "../id/id"

export type ToolContentPart = { type: "text"; text: string } | { type: "image"; mimeType: string; data: string }

const ALLOWED_IMAGE_MIMES = ["image/png", "image/jpeg", "image/gif", "image/webp"]
const MAX_IMAGES = 10
const MAX_IMAGE_BYTES = 5 * 1024 * 1024 // 5MB decoded

export function isRichToolResult(result: unknown): result is { content: ToolContentPart[] } {
  if (result == null) return false
  if (typeof result !== "object") return false
  if (!("content" in result)) return false
  return Array.isArray((result as { content: unknown }).content)
}

function isValidTextPart(part: unknown): part is { type: "text"; text: string } {
  if (part == null || typeof part !== "object") return false
  const p = part as Record<string, unknown>
  return p["type"] === "text" && typeof p["text"] === "string"
}

function isValidImagePart(part: unknown): part is { type: "image"; mimeType: string; data: string } {
  if (part == null || typeof part !== "object") return false
  const p = part as Record<string, unknown>
  return p["type"] === "image" && typeof p["mimeType"] === "string" && typeof p["data"] === "string"
}

export function normalizeToolContent(
  content: ToolContentPart[],
  sessionID: string,
  messageID: string,
): { output: string; attachments: MessageV2.FilePart[] } {
  const textParts: string[] = []
  const attachments: MessageV2.FilePart[] = []

  for (const part of content) {
    if (isValidTextPart(part)) {
      textParts.push(part.text)
      continue
    }

    if (!isValidImagePart(part)) continue
    if (attachments.length >= MAX_IMAGES) continue
    if (!ALLOWED_IMAGE_MIMES.includes(part.mimeType)) continue

    // Rough size check (base64 is ~4/3 of original)
    const estimatedBytes = (part.data.length * 3) / 4
    if (estimatedBytes > MAX_IMAGE_BYTES) continue

    attachments.push({
      id: Identifier.ascending("part"),
      sessionID,
      messageID,
      type: "file",
      mime: part.mimeType,
      url: `data:${part.mimeType};base64,${part.data}`,
    })
  }

  // Fallback output when only images returned
  const joined = textParts.join("\n\n")
  const output = joined.trim()
    ? joined
    : attachments.length > 0
      ? `Returned ${attachments.length} image${attachments.length > 1 ? "s" : ""}.`
      : ""

  return { output, attachments }
}
