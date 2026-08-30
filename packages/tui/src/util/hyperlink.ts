const URL_MAX_LEN = 4096
const OPENABLE = new Set(["http:", "https:", "mailto:"])

export type HyperlinkBuffer = {
  width: number
  height: number
  buffers: { attributes: ArrayLike<number> }
  lib: {
    attributesGetLinkId: (attributes: number) => number
    linkGetUrl: (linkId: number, maxLen?: number) => string
  }
}

export function urlAt(buffer: HyperlinkBuffer, x: number, y: number): string | null {
  if (!Number.isInteger(x) || !Number.isInteger(y)) return null
  if (x < 0 || y < 0 || x >= buffer.width || y >= buffer.height) return null

  const attributes = buffer.buffers.attributes[y * buffer.width + x]
  if (attributes === undefined) return null

  const linkId = buffer.lib.attributesGetLinkId(attributes)
  if (!linkId) return null

  const url = buffer.lib.linkGetUrl(linkId, URL_MAX_LEN).trim()
  return url || null
}

export function isOpenableHyperlink(url: string): boolean {
  try {
    return OPENABLE.has(new URL(url).protocol)
  } catch {
    return false
  }
}

export function openableUrlAt(buffer: HyperlinkBuffer, x: number, y: number): string | null {
  const url = urlAt(buffer, x, y)
  if (!url || !isOpenableHyperlink(url)) return null
  return url
}
