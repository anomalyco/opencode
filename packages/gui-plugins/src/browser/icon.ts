import { nativeImage } from "electron"
import { ICON_SIZE, iconImage } from "./icon-image"
import { MAX_ICON_URL } from "./ipc"
import type { BrowserNetwork } from "./network"

/**
 * The first of a page's icon candidates that loads and decodes, as a PNG data URL of at most 32px: small enough to
 * report and to store, whatever the site served. A site's SVG is never kept or drawn, and neither is anything else
 * that is not a picture. Never rejects: a candidate that fails falls through to the next, and a page with none that
 * loads has no icon.
 */
export function loadIcon(candidates: readonly string[], network: BrowserNetwork | null) {
  return candidates
    .filter((url) => /^(?:https?:|data:image\/)/i.test(url))
    .slice(0, 3)
    .reduce<Promise<string | undefined>>(
      (found, url) =>
        found.then(async (icon) => {
          if (icon) return icon
          const file = /^data:/i.test(url) ? inline(url) : (await network?.icon(url).catch(() => undefined))?.data

          return file ? encode(file) : undefined
        }),
      Promise.resolve(undefined),
    )
}

function inline(url: string) {
  const match = /^data:image\/[\w.+-]+(;base64)?,(.*)$/is.exec(url)

  if (!match) return
  const body = match[2] ?? ""

  return match[1] ? Buffer.from(body, "base64") : unescape(body)
}

// Percent-decodes to bytes; a stray `%` stays as it is.
function unescape(text: string) {
  return Buffer.concat(
    text
      .split(/(%[\da-f]{2})/i)
      .map((part) => (/^%[\da-f]{2}$/i.test(part) ? Buffer.from([parseInt(part.slice(1), 16)]) : Buffer.from(part))),
  )
}

function encode(file: Buffer) {
  const readable = iconImage(file)
  const image = readable && nativeImage.createFromBuffer(readable)

  if (!image || image.isEmpty()) return
  const size = image.getSize()

  // The longer side fits the kept size; resizing one side keeps the shape.
  const fitted =
    Math.max(size.width, size.height) <= ICON_SIZE
      ? image
      : image.resize(size.width >= size.height ? { width: ICON_SIZE, quality: "best" } : { height: ICON_SIZE, quality: "best" })

  const url = fitted.toDataURL()

  return url.length <= MAX_ICON_URL ? url : undefined
}
