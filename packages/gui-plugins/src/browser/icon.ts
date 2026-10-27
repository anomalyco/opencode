import { nativeImage } from "electron"
import { MAX_ICON_URL } from "./ipc"
import type { BrowserNetwork } from "./network"

type Fetched = { mime: string; data: Buffer }

/**
 * The first of a page's icon candidates that loads, as a data URL small enough to report and store. An SVG stays as
 * it is; any other format is redrawn as a PNG of at most 32px, which also drops anything that is not an image. Never
 * rejects: a candidate that fails falls through to the next.
 */
export function loadIcon(candidates: readonly string[], network: BrowserNetwork | null) {
  return candidates
    .filter((url) => /^(?:https?:|data:image\/)/i.test(url))
    .slice(0, 3)
    .reduce<Promise<string | undefined>>(
      (found, url) =>
        found.then(async (icon) => {
          if (icon) return icon
          const fetched = /^data:/i.test(url) ? inline(url) : await network?.icon(url).catch(() => undefined)

          return fetched ? encode(fetched) : undefined
        }),
      Promise.resolve(undefined),
    )
}

function inline(url: string): Fetched | undefined {
  const match = /^data:(image\/[\w.+-]+)(;base64)?,(.*)$/is.exec(url)

  if (!match) return
  const body = match[3] ?? ""

  return { mime: (match[1] ?? "").toLowerCase(), data: match[2] ? Buffer.from(body, "base64") : unescape(body) }
}

// Percent-decodes to bytes. A stray `%`, as in `width="100%"`, stays as it is rather than failing the whole icon.
function unescape(text: string) {
  return Buffer.concat(
    text
      .split(/(%[\da-f]{2})/i)
      .map((part) => (/^%[\da-f]{2}$/i.test(part) ? Buffer.from([parseInt(part.slice(1), 16)]) : Buffer.from(part))),
  )
}

function encode(fetched: Fetched) {
  // An SVG in an <img> runs no script and loads nothing, so it needs no redrawing; one with no drawing is no icon.
  if (fetched.mime === "image/svg+xml") {
    if (!/<svg[\s>]/i.test(fetched.data.toString("utf8"))) return
    const url = `data:image/svg+xml;base64,${fetched.data.toString("base64")}`

    return url.length <= MAX_ICON_URL ? url : undefined
  }

  const image = nativeImage.createFromBuffer(fetched.data)

  if (image.isEmpty()) return
  const size = image.getSize()

  // The longer side fits 32px; resizing one side keeps the shape.
  const fitted =
    Math.max(size.width, size.height) <= 32
      ? image
      : image.resize(size.width >= size.height ? { width: 32, quality: "best" } : { height: 32, quality: "best" })

  const url = fitted.toDataURL()

  return url.length <= MAX_ICON_URL ? url : undefined
}
