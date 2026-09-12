import {
  CodeRenderable,
  RenderableEvents,
  ScrollBoxRenderable,
  StyledText,
  TextRenderable,
  createTextAttributes,
  parseColor,
  type ColorInput,
  type MarkdownCodeBlockRenderer,
  type RenderContext,
} from "@opentui/core"
import stringWidth from "string-width"
import { renderLatex } from "./render"
import { LatexParseError, type MathLayout } from "./types"

export type LatexOptions = {
  text: ColorInput
  subdued: ColorInput
}

type LatexFrame = {
  source: string
  layout: MathLayout
}

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
      ? { source: token.text, layout }
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
                fg: /^[()[\]{}|\u221a\u239b-\u23ad\u2500-\u257f]$/u.test(cell?.char ?? "") ? subdued : text,
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
    const viewport = new ScrollBoxRenderable(context, {
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
    return viewport
  }
}

function layoutLatex(source: string) {
  try {
    return renderLatex(source, { strict: true, unknownCommands: "preserve", displayMode: true })
  } catch (error) {
    // Preserve the exact source for incomplete math, unsupported structures, and oversized input.
    if (error instanceof LatexParseError || error instanceof RangeError) return undefined
    throw error
  }
}
