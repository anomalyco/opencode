// A provider error that embeds a full HTML document (e.g. an nginx 503 page)
// is transport noise: the retry notice should show a short, actionable line
// instead of printing multi-line markup inline. The raw body stays available
// in logs / provider diagnostics.
const HTML_DOCUMENT_RE = /<(?:!doctype\s+html|html|head|body)(?:\s|>)/i

export function isHtmlDocument(value: string): boolean {
  return HTML_DOCUMENT_RE.test(value)
}

export function boundRetryMessage(error: { message: string; status?: number | undefined }): string {
  const message = typeof error?.message === "string" ? error.message : ""
  if (!isHtmlDocument(message)) return message
  const status = error?.status
  if (status !== undefined && status >= 500) return `Provider temporarily unavailable (HTTP ${status})`
  if (status !== undefined) return `Provider request failed (HTTP ${status})`
  return "Provider request failed"
}
