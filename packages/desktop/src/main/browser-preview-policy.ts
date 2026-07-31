export type PreviewRect = {
  x: number
  y: number
  width: number
  height: number
}

const loopbackHosts = new Set(["localhost", "127.0.0.1", "::1"])

export function normalizePreviewUrl(value: string): string {
  const input = value.trim()
  const candidate = /^[a-z][a-z\d+.-]*:\/{1,2}/i.test(input) ? input : `http://${input}`
  let url: URL
  try {
    url = new URL(candidate)
  } catch {
    throw new Error("Enter a valid localhost URL")
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("Browser Preview supports HTTP and HTTPS")
  if (url.username || url.password) throw new Error("Browser Preview URLs cannot contain credentials")
  const hostname = url.hostname.replace(/^\[|\]$/g, "").toLowerCase()
  if (!loopbackHosts.has(hostname)) throw new Error("Browser Preview only supports localhost URLs")
  return url.toString()
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
