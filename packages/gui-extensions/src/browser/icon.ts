import { nativeImage } from "electron"
import { MAX_ICON_URL } from "./ipc"
import type { BrowserNetwork } from "./network"

type Fetched = { mime: string; data: Buffer }

/**
 * The first of a page's icon candidates that loads, as a data URL small enough to report and store. An SVG stays as
 * it is; any other format is redrawn as a PNG of at most 32px, which also drops anything that is not an image.
 */
export function loadIcon(candidates: readonly string[], network: BrowserNetwork | null) {
  return candidates
    .filter((url) => /^(?:https?:|data:image\/)/i.test(url))
    .slice(0, 3)
    .reduce<Promise<string | undefined>>(
      (found, url) =>
        found.then(async (icon) => {
          if (icon) return icon
          const fetched = url.startsWith("data:") ? inline(url) : await network?.icon(url)

          return fetched ? encode(fetched) : undefined
        }),
      Promise.resolve(undefined),
    )
}

function inline(url: string): Fetched | undefined {
  const match = /^data:(image\/[\w.+-]+)(;base64)?,(.*)$/is.exec(url)

  if (!match) return
  const body = match[3] ?? ""

  return {
    mime: (match[1] ?? "").toLowerCase(),
    data: match[2] ? Buffer.from(body, "base64") : Buffer.from(decodeURIComponent(body)),
  }
}

function encode(fetched: Fetched) {
  // An SVG in an <img> runs no script and loads nothing, so it needs no redrawing.
  if (fetched.mime === "image/svg+xml") {
    const url = `data:image/svg+xml;base64,${fetched.data.toString("base64")}`

    return url.length <= MAX_ICON_URL ? url : undefined
  }

  const image = nativeImage.createFromBuffer(fetched.data)

  if (image.isEmpty()) return
  const url = (image.getSize().width > 32 ? image.resize({ width: 32, quality: "best" }) : image).toDataURL()

  return url.length <= MAX_ICON_URL ? url : undefined
}
