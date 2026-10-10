import type { ImageResolver } from "@betteroffice/docx/layout/render"
import type { YrsMediaSource } from "@betteroffice/docx/yrs"

/** An embedded image's source, which names a part of the package the session reads. */
const mediaToken = /^media:(0|[1-9]\d*)$/u

/** How many bytes of decoded images stay for repaints; the least recently drawn go first past it. */
const budget = 256 * 1024 * 1024

type Decoded = {
  readonly image: Promise<CanvasImageSource | null>
  /** The decoded image once it is one; the shared placeholder is never closed. */
  bitmap: ImageBitmap | undefined
}

/**
 * Resolves the display list's images in a worker, where there is no `Image` element: a `media:{n}` source decodes
 * from the bytes the session reads, and a `data:` or `blob:` source decodes in place. Anything else, such as a remote
 * address, resolves to nothing, so painting never makes a request. A part that is missing or cannot be decoded paints a
 * grey box, as the window's resolver does. Decoded images stay for repaints within `budget`.
 */
export function createBitmapImageResolver(media: (token: string) => YrsMediaSource | null) {
  const cache = new Map<string, Decoded>()
  const placeholder = greyBox()

  const decode = (source: string): Promise<CanvasImageSource | null> => {
    const token = mediaToken.test(source)
    const found = token ? media(source) : undefined

    if (token && !found) return Promise.resolve(placeholder)

    const blob = found
      ? Promise.resolve(new Blob([new Uint8Array(found.bytes)], { type: found.mimeType }))
      : fetch(source).then((response) => response.blob())

    return blob
      .then((value) => createImageBitmap(value))
      .then(
        (bitmap): CanvasImageSource => bitmap,
        () => (token ? placeholder : null),
      )
  }

  const resolve: ImageResolver = (source) => {
    if (!mediaToken.test(source) && !source.startsWith("blob:") && !source.startsWith("data:")) return null

    const cached = cache.get(source)

    if (cached) {
      // Map order is drawing order: the least recently drawn come first.
      cache.delete(source)
      cache.set(source, cached)

      return cached.image
    }

    const entry: Decoded = {
      image: decode(source).then((image) => {
        if (image instanceof ImageBitmap) entry.bitmap = image

        return image
      }),
      bitmap: undefined,
    }

    cache.set(source, entry)

    return entry.image
  }

  return {
    resolve,
    /** Closes the least recently drawn images past the budget. Call it between paints, never during one. */
    trim() {
      const size = (entry: Decoded) => (entry.bitmap ? entry.bitmap.width * entry.bitmap.height * 4 : 0)

      ;[...cache].reduce(
        (total, [source, entry]) => {
          if (total <= budget || !entry.bitmap) return total

          const freed = size(entry)

          entry.bitmap.close()
          cache.delete(source)

          return total - freed
        },
        [...cache.values()].reduce((total, entry) => total + size(entry), 0),
      )
    },
  }
}

/** The grey box a missing image paints: one pixel the painter stretches over the image's place. */
function greyBox() {
  const canvas = new OffscreenCanvas(1, 1)
  const context = canvas.getContext("2d")

  if (!context) return null

  context.fillStyle = "#e6e6e6"
  context.fillRect(0, 0, 1, 1)

  return canvas
}
