import { Plugin } from "@opencode-ai/plugin/tui"
import {
  CodeRenderable,
  ImageRenderable,
  RenderableEvents,
  ScrollBoxRenderable,
  StyledText,
  TextRenderable,
  createTextAttributes,
  parseColor,
  resolveImageRenderProtocol,
  rgbToHex,
  type ColorInput,
  type MarkdownCodeBlockRenderer,
  type RenderContext,
} from "@opentui/core"
import { LatexParseError, renderLatex, type MathLayout } from "opentui-math"
import { stringWidth } from "../../util/string-width"

export type LatexOptions = {
  text: ColorInput
  subdued: ColorInput
  background: ColorInput
  mode?: "auto" | "cells"
}

type LatexImage = {
  source: string
  color: string
  background: string
  view: ImageRenderable
}

type LatexFrame = {
  source: string
  layout: MathLayout
  image?: LatexImage
}

class LatexViewport extends ScrollBoxRenderable {
  preview?: ImageRenderable

  override destroyRecursively() {
    const preview = this.preview
    // Let the next Markdown block adopt the loaded image without decoding or flashing a fallback.
    if (preview?.parent === this.content) this.remove(preview)
    super.destroyRecursively()
    if (preview)
      queueMicrotask(() => {
        if (!preview.parent) preview.destroy()
      })
  }
}

export default Plugin.define({
  id: "opencode.latex",
  setup(context) {
    const render = createLatexCodeBlockRenderer(context.renderer, () => ({
      text: context.theme.text.default,
      subdued: context.theme.text.subdued,
      background: context.theme.background.default,
      mode: context.options.mode === "cells" ? "cells" : "auto",
    }))
    context.markdown.registerCodeBlockRenderer("latex", render)
    context.markdown.registerCodeBlockRenderer("math", render)
  },
})

export function createLatexCodeBlockRenderer(
  context: RenderContext,
  options: () => LatexOptions,
): MarkdownCodeBlockRenderer {
  const lastGood = new Map<string, LatexFrame>()
  return (token, render) => {
    const fallback = render.defaultRender()
    const key = fallback?.id
    const previous = key ? lastGood.get(key) : undefined
    const retained = previous && token.text.startsWith(previous.source) ? previous : undefined
    const fence = /^ {0,3}(`{3,}|~{3,})/.exec(token.raw)?.[1]
    const streaming =
      fallback instanceof CodeRenderable &&
      fallback.streaming &&
      fence &&
      !new RegExp(`\\n {0,3}${fence[0]}{${fence.length},}\\s*$`).test(token.raw)
    const layout = layoutLatex(token.text)
    const frame: LatexFrame | undefined = layout
      ? { source: token.text, layout, image: retained?.image }
      : streaming && retained
        ? { ...retained }
        : undefined
    if (!frame) return fallback ?? undefined
    const palette = options()
    const text = parseColor(palette.text)
    const subdued = parseColor(palette.subdued)
    const formula = new TextRenderable(context, {
      content: new StyledText(
        frame.layout.cells.flatMap((row, index) => [
          ...Array.from(row).flatMap((cell, column) => {
            // Wide glyphs already occupy the following cell; do not emit another space for it.
            if (column > 0 && stringWidth(row[column - 1]?.char ?? "") > 1) return []
            return [
              {
                __isChunk: true as const,
                text: cell?.char ?? " ",
                fg: /^[()[\]{}|\u239b-\u23ad\u2500-\u257f]$/u.test(cell?.char ?? "") ? subdued : text,
                attributes: createTextAttributes({
                  bold: cell?.style?.bold || /^[=<>\u2260\u2261\u2264\u2265\u2248]$/u.test(cell?.char ?? ""),
                  italic: cell?.style?.italic,
                  dim: cell?.style?.dim,
                }),
              },
            ]
          }),
          ...(index < frame.layout.height - 1 ? [{ __isChunk: true as const, text: "\n", fg: text }] : []),
        ]),
      ),
      width: "100%",
      minWidth: frame.layout.width,
      height: frame.layout.height,
      wrapMode: "none",
      selectable: false,
      flexShrink: 0,
    })
    const viewport = new LatexViewport(context, {
      width: "100%",
      height: frame.layout.height,
      flexShrink: 0,
      marginTop: 1,
      scrollX: true,
      scrollY: false,
      onMouseScroll(event) {
        if (event.modifiers.shift || event.scroll?.direction === "left" || event.scroll?.direction === "right") {
          event.stopPropagation()
        }
      },
    })
    // The setters opt out of automatic scrollbar visibility; constructor options do not.
    viewport.horizontalScrollBar.visible = false
    viewport.verticalScrollBar.visible = false
    viewport.add(formula)
    if (key) {
      lastGood.set(key, frame)
      viewport.once(RenderableEvents.DESTROYED, () => {
        // Markdown destroys the old block before constructing its replacement in the same stack.
        queueMicrotask(() => {
          if (lastGood.get(key) === frame) lastGood.delete(key)
        })
      })
    }

    if (palette.mode === "cells") return viewport
    const color = rgbToHex(text)
    const background = rgbToHex(parseColor(palette.background))
    const image = frame.image
    if (
      image?.color === color &&
      image.background === background &&
      !image.view.isDestroyed &&
      image.view.effectiveProtocol !== "blocks"
    ) {
      viewport.add(image.view)
      viewport.preview = image.view
      formula.visible = false
      viewport.height = image.view.height
      if (image.source === frame.source) return viewport
    }
    viewport.renderBefore = () => {
      if (viewport.screenY >= context.height || viewport.screenY + viewport.height <= 0) return
      if (resolveImageRenderProtocol("auto", context.capabilities, Boolean(context.resolution)) === "blocks") return
      viewport.renderBefore = undefined
      // Markdown replaces custom blocks while streaming. Wait briefly so superseded prefixes do not rasterize.
      const timer = setTimeout(() => {
        void renderImage(frame, color, background, viewport, formula).catch(() => {
          if (viewport.isDestroyed) return
          viewport
            .getChildren()
            .filter((child) => child instanceof ImageRenderable)
            .forEach((child) => child.destroy())
          frame.image = undefined
          viewport.preview = undefined
          formula.visible = true
          viewport.height = frame.layout.height
        })
      }, 75)
      viewport.once(RenderableEvents.DESTROYED, () => clearTimeout(timer))
    }
    return viewport
  }
}

function layoutLatex(source: string) {
  try {
    return renderLatex(source, { strict: true, displayMode: true })
  } catch (error) {
    // Preserve the exact source for incomplete math, unsupported commands, and oversized input.
    if (error instanceof LatexParseError || error instanceof RangeError) return undefined
    throw error
  }
}

async function renderImage(
  frame: LatexFrame,
  color: string,
  background: string,
  viewport: LatexViewport,
  formula: TextRenderable,
) {
  const { renderLatexToPng } = await import("opentui-math/graphics")
  if (viewport.isDestroyed) return
  // OpenTUI 0.5.8 clears graphics cells to the terminal default background. Composite against
  // the theme until it preserves cell backgrounds, otherwise transparent pixels reveal a rectangle.
  const raster = await renderLatexToPng(frame.source, {
    foregroundColor: color,
    backgroundColor: background,
    fontSize: 24,
    pixelRatio: 2,
  })
  if (viewport.isDestroyed) return

  // A 2x raster and logical 16px cell height keep math proportional to text when the terminal font is zoomed.
  const height = Math.max(1, Math.ceil(raster.height / 32))
  const image = new ImageRenderable(viewport.ctx, {
    source: raster.png,
    height,
    flexShrink: 0,
    visible: false,
  })
  image.width = Math.max(1, Math.ceil((raster.width / raster.height) * height * image.cellAspectRatio))
  image.minWidth = image.width
  viewport.add(image)
  await image.loadPromise
  if (viewport.isDestroyed) return
  if (image.loadError) {
    image.destroy()
    throw image.loadError
  }
  viewport
    .getChildren()
    .filter((child) => child instanceof ImageRenderable && child !== image)
    .forEach((child) => child.destroy())
  frame.image = { source: frame.source, color, background, view: image }
  viewport.preview = image
  formula.visible = false
  image.visible = true
  viewport.height = height
}
