import stringWidth from "string-width"
import { splitDiagramLines } from "./text-lines.js"

export { parseDiagramTextLines, splitDiagramLines } from "./text-lines.js"

export interface DiagramTextBoxSize {
  width: number
  height: number
  lines: string[]
}

export function diagramTextWidth(value: string): number {
  return stringWidth(value)
}

export const DIAGRAM_LABEL_PADDING_X = 1

export function padDiagramLabelLine(value: string): string {
  const padding = " ".repeat(DIAGRAM_LABEL_PADDING_X)
  return `${padding}${value}${padding}`
}

export function measureDiagramLabelWidth(value: string, measure = diagramTextWidth): number {
  return Math.max(...splitDiagramLines(value).map((line) => measure(line) + DIAGRAM_LABEL_PADDING_X * 2))
}

const graphemeSegmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" })

export function* diagramTextGraphemes(value: string): Generator<string> {
  for (const { segment } of graphemeSegmenter.segment(value)) yield segment
}

export function measureDiagramTextBox(
  value: string,
  options: { paddingX?: number; paddingY?: number; minInnerWidth?: number } = {},
): DiagramTextBoxSize {
  const lines = splitDiagramLines(value)
  const innerWidth = Math.max(...lines.map(diagramTextWidth), options.minInnerWidth ?? 1)
  return {
    width: innerWidth + (options.paddingX ?? 0) * 2,
    height: lines.length + (options.paddingY ?? 0) * 2,
    lines,
  }
}
