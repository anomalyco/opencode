import { BoxRenderable, ImageRenderable, type MarkdownOptions, type RenderContext } from "@opentui/core"
import type { OpenCodeClient } from "@opencode/client"
import { imageReadRequest, localImagePath } from "@opencode/util/markdown-image"

type RenderNode = NonNullable<MarkdownOptions["renderNode"]>

export type MarkdownImages = ReturnType<typeof createMarkdownImages>

/** Session-scoped image reads for Markdown, cached so streaming rebuilds never refetch a file. */
export function createMarkdownImages(input: {
  read: OpenCodeClient["file"]["read"]
  directory: () => string | undefined
}) {
  const controller = new AbortController()
  const files = new Map<string, Promise<Uint8Array>>()
  const sizes = new Map<string, { width: number; height: number }>()

  return {
    sizes,
    load(source: string) {
      const directory = input.directory()
      const path = localImagePath(source)
      if (!directory || !path || !/\.(png|jpe?g|webp|gif)$/i.test(path)) return
      const key = `${directory}\0${path}`
      const cached = files.get(key)
      if (cached) return { key, bytes: cached }
      const bytes = input.read(imageReadRequest(directory, path), { signal: controller.signal })
      // Failed reads stay cached so a streaming paragraph does not retry them on every update.
      bytes.catch(() => undefined)
      files.set(key, bytes)
      return { key, bytes }
    },
    dispose() {
      controller.abort()
      files.clear()
      sizes.clear()
    },
  }
}

/**
 * Wraps a Markdown renderNode so paragraphs with local images render the images as blocks below
 * the text. Image-only paragraphs show just the images, falling back to the alt text on failure.
 */
export function createMarkdownImageRenderer(input: {
  renderer: RenderContext
  images: MarkdownImages
  base: RenderNode | undefined
  maxHeight: () => number
  open: (bytes: Uint8Array, alt: string) => void
}): RenderNode {
  return (token, context) => {
    if (token.type !== "paragraph" || !context.conceal) return input.base?.(token, context)
    const children = token.tokens ?? []
    const sources = children.flatMap((child) => {
      if (child.type !== "image") return []
      const file = input.images.load(child.href)
      return file ? [{ ...file, alt: child.text }] : []
    })
    if (sources.length === 0) return input.base?.(token, context)

    const imageOnly = children.every((child) => child.type === "image" || !child.raw.trim())
    const fits: (() => void)[] = []
    // Width is unknown until layout, so images are fitted again whenever the block resizes.
    const column = new BoxRenderable(input.renderer, {
      width: "100%",
      flexShrink: 0,
      gap: 1,
      onSizeChange: () => fits.forEach((fit) => fit()),
    })
    const text = context.defaultRender()
    if (text) {
      text.visible = !imageOnly
      column.add(text)
    }
    sources.forEach((source) => {
      const size = input.images.sizes.get(source.key)
      const image = new ImageRenderable(input.renderer, {
        width: size?.width ?? 1,
        height: size?.height ?? 1,
        flexShrink: 0,
        fit: "fit",
        protocol: "auto",
        onLoad: () => fit(),
        onError: () => fail(),
      })
      const fit = () => {
        if (!image.image || column.width <= 0) return
        const fitted = image.getFittedSize(column.width, input.maxHeight())
        input.images.sizes.set(source.key, fitted)
        image.width = fitted.width
        image.height = fitted.height
      }
      const fail = () => {
        image.visible = false
        if (text) text.visible = true
      }
      fits.push(fit)
      column.add(image)
      source.bytes.then((bytes) => {
        if (image.isDestroyed) return
        image.source = bytes
        image.onMouseUp = (event) => {
          if (event.button !== 0) return
          event.stopPropagation()
          input.open(bytes, source.alt)
        }
      }, fail)
    })
    return column
  }
}
