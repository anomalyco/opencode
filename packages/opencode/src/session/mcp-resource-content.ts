export const MAX_MCP_RESOURCE_BLOB_BYTES = 10 * 1024 * 1024

const SUPPORTED_MCP_RESOURCE_ATTACHMENT_MIMES = new Set([
  "application/pdf",
  "image/gif",
  "image/jpeg",
  "image/png",
  "image/webp",
])

export function normalizeMcpResourceMime(value: string | undefined) {
  return value?.split(";")[0]?.trim().toLowerCase() || "application/octet-stream"
}

export function isSupportedMcpResourceAttachmentMime(value: string) {
  return SUPPORTED_MCP_RESOURCE_ATTACHMENT_MIMES.has(normalizeMcpResourceMime(value))
}

export function isTextMcpResourceMime(value: string) {
  return normalizeMcpResourceMime(value).startsWith("text/")
}

export function decodeMcpResourceTextBlob(value: string) {
  return Buffer.from(value.replace(/\s/g, ""), "base64").toString("utf8")
}

export function mcpResourceBase64Size(value: string) {
  const trimmed = value.replace(/\s/g, "")
  const padding = trimmed.endsWith("==") ? 2 : trimmed.endsWith("=") ? 1 : 0
  return Math.max(0, Math.floor((trimmed.length * 3) / 4) - padding)
}

export function formatMcpResourceBytes(value: number) {
  if (value < 1024) return `${value} B`
  if (value < 1024 * 1024) return `${Math.ceil(value / 1024)} KB`
  return `${Math.ceil(value / (1024 * 1024))} MB`
}
