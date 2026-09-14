import type { ReadMarkdownImage } from "../context/markdown"

export function localImagePath(source: string) {
  const value = source.trim().replaceAll("\\", "/")
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

function decodePath(value: string) {
  try {
    const path = decodeURIComponent(value)
    if (/[\u0000-\u001f\u007f]/.test(path) || path.startsWith("//") || path.startsWith("\\\\")) return
    return path
  } catch {
    return
  }
}

export function createMarkdownImages(read: ReadMarkdownImage) {
  const entries = new Map<string, { controller: AbortController; result: Promise<string | undefined>; url?: string }>()
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
        const entry = existing ?? {
          controller: new AbortController(),
          result: Promise.resolve<string | undefined>(undefined),
          url: undefined as string | undefined,
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
