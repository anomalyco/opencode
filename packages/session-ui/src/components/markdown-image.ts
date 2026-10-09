import { isLineRangeHash, parsePathLineSuffix } from "@opencode/util/path"
import type { ReadMarkdownImage } from "../context/markdown"

export function localImagePath(source: string) {
  // Marked percent-encodes image sources, so `C:\tmp\chart.png` arrives as `C:%5Ctmp%5Cchart.png`.
  const value = source.trim().replace(/\\|%5c/gi, "/")

  if (!value || /[\u0000-\u001f\u007f]/.test(value) || value.startsWith("//")) return

  if (/^file:/i.test(value)) {
    if (!URL.canParse(value)) return
    const url = new URL(value)

    if (url.hostname && url.hostname !== "localhost") return

    return decodePath(url.pathname.replace(/^\/([a-z]:\/)/i, "$1"))
  }

  if (/^[a-z][a-z\d+.-]*:/i.test(value) && !/^[a-z]:\//i.test(value)) return

  return decodePath(value)
}

/**
 * A link is local when it names a file on disk instead of a web resource. Fragment-only and
 * query-only hrefs stay in-page; mailto and other schemes stay external. Line-range fragments
 * such as `#L42` and `#L42-L58` stay attached so the file viewer can select the target lines.
 */
export function localLinkPath(href: string) {
  const value = href.trim()

  if (!value || value.startsWith("#") || value.startsWith("?")) return

  const hashIndex = value.indexOf("#")
  const hash = hashIndex === -1 ? "" : value.slice(hashIndex)
  const target = (value.split(/[?#]/, 1)[0] ?? "").replace(/\\|%5c/gi, "/")
  // `app.tsx:42` is a file and line, not a URL scheme. The `.` or `/` keeps `tel:5551234` external.
  const cited = parsePathLineSuffix(target)
  const line = cited.path !== target && /[./]/.test(cited.path) ? cited : undefined
  const base = localImagePath(line?.path ?? target)

  if (!base) return

  if (line?.selection) {
    const range = line.selection.end === line.selection.start ? "" : `-L${line.selection.end}`

    return `${base}#L${line.selection.start}${range}`
  }

  return `${base}${isLineRangeHash(hash) ? hash : ""}`
}

function decodePath(value: string) {
  try {
    const path = decodeURIComponent(value)

    if (/[\u0000-\u001f\u007f]/.test(path) || path.startsWith("//") || path.startsWith("\\\\")) return

    return path
  } catch {
    return
  }
}

type ImageEntry = { controller: AbortController; result: Promise<string | undefined>; url?: string }

export function createMarkdownImages(read: ReadMarkdownImage) {
  const entries = new Map<string, ImageEntry>()

  return {
    update(root: HTMLElement) {
      const images = Array.from(root.querySelectorAll<HTMLImageElement>("img[data-local-image]"))
      const paths = new Set(images.map((image) => image.dataset.localImage))
      entries.forEach((entry, path) => {
        if (paths.has(path)) return
        entry.controller.abort()

        if (entry.url) URL.revokeObjectURL(entry.url)
        entries.delete(path)
      })
      images.forEach((image) => {
        const path = image.dataset.localImage

        if (!path) return
        const existing = entries.get(path)

        const entry: ImageEntry = existing ?? {
          controller: new AbortController(),
          result: Promise.resolve(undefined),
        }

        if (!existing) {
          entries.set(path, entry)
          entry.result = read(path, entry.controller.signal)
            .then(async (blob) => {
              if (!blob || entry.controller.signal.aborted) return

              // SVG documents must not inherit the app origin if opened outside the image element.
              if (blob.type === "image/svg+xml")
                return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(await blob.text())}`
              entry.url = URL.createObjectURL(blob)

              return entry.url
            })
            .catch(() => undefined)
        }

        void entry.result.then((url) => {
          if (!url || entry.controller.signal.aborted || !root.contains(image) || image.dataset.localImage !== path)
            return
          image.src = url
        })
      })
    },
    dispose() {
      entries.forEach((entry) => {
        entry.controller.abort()

        if (entry.url) URL.revokeObjectURL(entry.url)
      })
      entries.clear()
    },
  }
}
