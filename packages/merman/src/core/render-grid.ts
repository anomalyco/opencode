import { StyledText, type TextChunk } from "@opentui/core"
import type { DiagramCanvas, DiagramCanvasRun, DiagramCanvasRunOptions } from "./canvas.js"
import { ANSI } from "./terminal/ansi.js"

export interface RenderDiagramGridAnsiOptions<Style extends string, Metadata extends object = object>
  extends DiagramCanvasRunOptions<Style, Metadata> {
  trimOutputEnd?: boolean
}

export function renderDiagramGridAnsi<Style extends string, Metadata extends object = object>(
  grid: DiagramCanvas<Style, Metadata>,
  styleAnsi: (run: DiagramCanvasRun<Style, Metadata>) => string | undefined,
  options: RenderDiagramGridAnsiOptions<Style, Metadata> = {},
): string {
  const { trimOutputEnd, ...runOptions } = options
  const output: string[] = []

  grid.forEachRun(
    (run) => {
      const ansi = styleAnsi(run)
      output.push(ansi ? `${ansi}${run.text}${ANSI.reset}` : run.text)
    },
    () => {
      output.push("\n")
    },
    runOptions,
  )

  const text = output.join("")
  return trimOutputEnd ? text.trimEnd() : text
}

export function renderDiagramGridStyledText<Style extends string, Metadata extends object = object>(
  grid: DiagramCanvas<Style, Metadata>,
  fg: (run: DiagramCanvasRun<Style, Metadata>) => TextChunk["fg"],
  bg?: (run: DiagramCanvasRun<Style, Metadata>) => TextChunk["bg"],
  options?: DiagramCanvasRunOptions<Style, Metadata>,
): StyledText {
  const chunks: TextChunk[] = []

  grid.forEachRun(
    (run) => {
      chunks.push({ __isChunk: true, text: run.text, fg: fg(run), bg: bg?.(run) })
    },
    () => {
      chunks.push({ __isChunk: true, text: "\n" })
    },
    options,
  )

  return new StyledText(chunks)
}
