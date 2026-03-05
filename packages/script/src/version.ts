const PREVIEW = "0.0.0-"

export function sanitizeChannel(value: string) {
  const cleaned = value
    .trim()
    .replace(/[^0-9A-Za-z-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
  return cleaned || "preview"
}

export function sanitizePreviewVersion(value: string) {
  if (!value.startsWith(PREVIEW)) return value
  return `${PREVIEW}${sanitizeChannel(value.slice(PREVIEW.length))}`
}

export function previewVersion(channel: string, date = new Date()) {
  return `${PREVIEW}${sanitizeChannel(channel)}-${date.toISOString().slice(0, 16).replace(/[-:T]/g, "")}`
}
