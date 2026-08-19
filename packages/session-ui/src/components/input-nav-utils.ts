import type { Part } from "@opencode-ai/sdk/v2"

const BAR_MIN_WIDTH = 4
const BAR_MAX_WIDTH = 24
const TEXT_SCALE_FACTOR = 0.05
const PREVIEW_TEXT_MAX_LENGTH = 200

export function computeBarWidth(text: string): number {
  if (!text) return BAR_MIN_WIDTH
  const scaled = Math.ceil(text.length * TEXT_SCALE_FACTOR)
  return Math.min(Math.max(scaled, BAR_MIN_WIDTH), BAR_MAX_WIDTH)
}

export interface PreviewContent {
  text?: string
  images: { filename?: string; url: string }[]
  files: { filename?: string; url: string; mime: string }[]
}

export function extractPreviewContent(parts: Part[]): PreviewContent {
  const textPart = parts.find(
    (p): p is Part & { type: "text"; text: string } => p.type === "text" && !(p as { synthetic?: boolean }).synthetic,
  )
  const fileParts = parts.filter((p): p is Part & { type: "file"; mime: string; url: string } => p.type === "file")

  const images = fileParts
    .filter((p) => p.mime.startsWith("image/"))
    .map((p) => ({ filename: (p as { filename?: string }).filename, url: p.url }))

  const files = fileParts
    .filter((p) => !p.mime.startsWith("image/"))
    .map((p) => ({
      filename: (p as { filename?: string }).filename,
      url: p.url,
      mime: p.mime,
    }))

  let text: string | undefined
  if (textPart) {
    text =
      textPart.text.length > PREVIEW_TEXT_MAX_LENGTH
        ? textPart.text.slice(0, PREVIEW_TEXT_MAX_LENGTH) + "..."
        : textPart.text
  }

  return { text, images, files }
}
