import type { BrowserPreviewElement } from "@opencode-ai/app"

export type PreviewRect = {
  x: number
  y: number
  width: number
  height: number
}

const MAX_ELEMENT_SELECTOR_BYTES = 4 * 1024
const MAX_ELEMENT_TEXT_BYTES = 16 * 1024
const MAX_ELEMENT_HTML_BYTES = 64 * 1024
const MAX_URL_BYTES = 2 * 1024

function boundedString(value: unknown, max: number, label: string) {
  if (typeof value !== "string") throw new Error(`Invalid Browser Preview element ${label}`)
  const bytes = new TextEncoder().encode(value)
  if (bytes.length <= max) return { value, truncated: false }
  return { value: new TextDecoder().decode(bytes.slice(0, max)), truncated: true }
}

function finiteNumber(value: unknown) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error("Invalid Browser Preview element bounds")
  }
  return value
}

export function normalizePreviewUrl(value: string): string {
  const input = value.trim()
  if (new TextEncoder().encode(input).length > MAX_URL_BYTES) throw new Error("Browser Preview URL is too long")
  const scheme = input.match(/^[a-z][a-z\d+.-]*:(.*)$/i)
  const candidate = scheme && !/^\d/.test(scheme[1]) ? input : `http://${input}`
  let url: URL
  try {
    url = new URL(candidate)
  } catch {
    throw new Error("Enter a valid web address")
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("Browser Preview supports HTTP and HTTPS")
  if (url.username || url.password) throw new Error("Browser Preview URLs cannot contain credentials")
  if (!url.hostname) throw new Error("Enter a valid web address")
  return url.toString()
}

export function resolvePreviewNavigation(value: string): string {
  const input = value.trim()
  if (!input) throw new Error("Enter a web address or search term")
  if (new TextEncoder().encode(input).length > MAX_URL_BYTES) throw new Error("Browser Preview URL is too long")
  const address =
    /^[a-z][a-z\d+.-]*:/i.test(input) ||
    /^localhost(?::\d+)?(?:[/?#]|$)/i.test(input) ||
    /^\d{1,3}(?:\.\d{1,3}){3}(?::\d+)?(?:[/?#]|$)/.test(input) ||
    /^\[[\da-f:]+\](?::\d+)?(?:[/?#]|$)/i.test(input) ||
    /^(?:[a-z\d-]+\.)+[a-z\d-]+(?::\d+)?(?:[/?#]|$)/i.test(input)
  if (address) return normalizePreviewUrl(input)
  const url = new URL("https://www.google.com/search")
  url.searchParams.set("q", input)
  return url.toString()
}

export function normalizePreviewElement(value: unknown, url: string): BrowserPreviewElement {
  if (!value || typeof value !== "object") throw new Error("Invalid Browser Preview element")
  const selector = boundedString(
    "selector" in value ? value.selector : undefined,
    MAX_ELEMENT_SELECTOR_BYTES,
    "selector",
  )
  const text = boundedString("text" in value ? value.text : undefined, MAX_ELEMENT_TEXT_BYTES, "text")
  const html = boundedString("html" in value ? value.html : undefined, MAX_ELEMENT_HTML_BYTES, "HTML")
  if (!selector.value.trim()) throw new Error("Invalid Browser Preview element selector")
  const tag = "tag" in value ? value.tag : undefined
  if (typeof tag !== "string" || !/^[a-z][a-z0-9-]*$/i.test(tag)) {
    throw new Error("Invalid Browser Preview element tag")
  }
  const rect = "rect" in value ? value.rect : undefined
  if (!rect || typeof rect !== "object") throw new Error("Invalid Browser Preview element bounds")
  const x = finiteNumber("x" in rect ? rect.x : undefined)
  const y = finiteNumber("y" in rect ? rect.y : undefined)
  const width = finiteNumber("width" in rect ? rect.width : undefined)
  const height = finiteNumber("height" in rect ? rect.height : undefined)
  if (width < 0 || height < 0) {
    throw new Error("Invalid Browser Preview element bounds")
  }
  const elementUrl = new URL(normalizePreviewUrl(url))
  elementUrl.search = ""
  elementUrl.hash = ""
  return {
    url: elementUrl.toString(),
    selector: selector.value,
    tag: tag.toLowerCase(),
    text: text.value,
    html: html.value,
    rect: { x, y, width, height },
    textTruncated: text.truncated || ("textTruncated" in value && value.textTruncated === true),
    htmlTruncated: html.truncated || ("htmlTruncated" in value && value.htmlTruncated === true),
  }
}

export function normalizePreviewBounds(
  rect: PreviewRect,
  content: Pick<PreviewRect, "width" | "height">,
  zoomFactor: number,
): PreviewRect | null {
  const values = [rect.x, rect.y, rect.width, rect.height, content.width, content.height, zoomFactor]
  if (values.some((value) => !Number.isFinite(value))) return null
  if (rect.width <= 0 || rect.height <= 0 || content.width <= 0 || content.height <= 0 || zoomFactor <= 0) return null

  const x = Math.max(0, Math.round(rect.x * zoomFactor))
  const y = Math.max(0, Math.round(rect.y * zoomFactor))
  if (x >= content.width || y >= content.height) return null
  const width = Math.min(Math.round(rect.width * zoomFactor), Math.round(content.width) - x)
  const height = Math.min(Math.round(rect.height * zoomFactor), Math.round(content.height) - y)
  if (width <= 0 || height <= 0) return null
  return { x, y, width, height }
}
