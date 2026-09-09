import { StyledText, type TextChunk } from "@opentui/core"
import type { DiagramCanvas, DiagramCanvasRun, DiagramCanvasRunOptions } from "./canvas.js"

export function renderDiagramGridStyledText<Style extends string, Metadata extends object = object>(
  grid: DiagramCanvas<Style, Metadata>,
  fg: (run: DiagramCanvasRun<Style, Metadata>) => TextChunk["fg"],
  bg?: (run: DiagramCanvasRun<Style, Metadata>) => TextChunk["bg"],
  options?: DiagramCanvasRunOptions<Style, Metadata> & {
    attributes?: (run: DiagramCanvasRun<Style, Metadata>) => TextChunk["attributes"]
  },
): StyledText {
  const chunks: TextChunk[] = []

  grid.forEachRun(
    (run) => {
      chunks.push({
        __isChunk: true,
        text: run.text,
        fg: fg(run),
        bg: bg?.(run),
        attributes: options?.attributes?.(run),
      })
    },
    () => {
      chunks.push({ __isChunk: true, text: "\n" })
    },
    options,
  )

  return new StyledText(chunks)
}

export function renderDiagramGridStyledTextByStyle<Style extends string, Metadata extends object = object>(
  grid: DiagramCanvas<Style, Metadata>,
  foregrounds: Readonly<Record<Style, TextChunk["fg"]>>,
  backgrounds?: Readonly<Partial<Record<Style, TextChunk["bg"]>>>,
  options?: DiagramCanvasRunOptions<Style, Metadata> & {
    attributes?: (run: DiagramCanvasRun<Style, Metadata>) => TextChunk["attributes"]
  },
): StyledText {
  const background =
    backgrounds && Object.values(backgrounds).some((value) => value !== undefined)
      ? (run: DiagramCanvasRun<Style, Metadata>) => (run.style ? backgrounds[run.style] : undefined)
      : undefined
  return renderDiagramGridStyledText(
    grid,
    (run) => (run.style ? foregrounds[run.style] : undefined),
    background,
    options,
  )
}
