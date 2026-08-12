import { DiagramCanvas } from "../core/canvas.js"
import { splitDiagramLines } from "../core/text-lines.js"
import { diagramTextWidth } from "../core/text.js"
import type { TimelineGrid } from "./render-grid.js"
import type { TimelineCellStyle, TimelineDiagram, TimelineDiagramRenderOptions, TimelinePeriod } from "./types.js"

interface PeriodLayout {
  period: TimelinePeriod
  periodLines: string[]
  eventLines: string[][]
  height: number
}

const BRANCH = "──"

export function drawTimelineDiagramGrid(
  diagram: TimelineDiagram,
  _options: TimelineDiagramRenderOptions = {},
): TimelineGrid {
  const periodLayouts = new Map<TimelinePeriod, PeriodLayout>()
  let leftWidth = 0
  let rightWidth = 0
  let bodyHeight = 0

  for (const entry of diagram.entries) {
    if (entry.type === "section") {
      const lines = splitDiagramLines(entry.section.label)
      bodyHeight += lines.length + 1
      rightWidth = Math.max(rightWidth, ...lines.map(diagramTextWidth))
      continue
    }
    const periodLines = splitDiagramLines(entry.period.period)
    const eventLines = entry.period.events.map(splitDiagramLines)
    const eventHeight = eventLines.reduce((height, lines) => height + lines.length, 0)
    const height = Math.max(periodLines.length, eventHeight)
    periodLayouts.set(entry.period, { period: entry.period, periodLines, eventLines, height })
    leftWidth = Math.max(leftWidth, ...periodLines.map(diagramTextWidth))
    rightWidth = Math.max(rightWidth, ...eventLines.flat().map(diagramTextWidth))
    bodyHeight += height + 1
  }

  const titleLines = diagram.title ? splitDiagramLines(diagram.title) : []
  const bodyWidth = diagram.entries.length === 0 ? 0 : leftWidth + rightWidth + 7
  const titleWidth = titleLines.length === 0 ? 0 : Math.max(...titleLines.map(diagramTextWidth))
  const width = Math.max(bodyWidth, titleWidth)
  const titleHeight = titleLines.length === 0 ? 0 : titleLines.length + (diagram.entries.length === 0 ? 0 : 1)
  if (width === 0) return new DiagramCanvas(0, 0)

  const grid: TimelineGrid = new DiagramCanvas(width, titleHeight + bodyHeight)
  titleLines.forEach((line, index) =>
    setText(grid, Math.floor((width - diagramTextWidth(line)) / 2), index, line, "title"),
  )
  if (diagram.entries.length === 0) return grid

  const spineX = leftWidth + 3
  let y = titleHeight
  for (const entry of diagram.entries) {
    if (entry.type === "section") {
      const lines = splitDiagramLines(entry.section.label)
      setCell(grid, spineX, y, "◆", "section")
      lines.forEach((line, index) => setText(grid, spineX + 3, y + index, line, "section"))
      for (let row = y + 1; row < y + lines.length + 1; row++) setCell(grid, spineX, row, "│", "spine")
      y += lines.length + 1
      continue
    }

    const layout = periodLayouts.get(entry.period)!
    for (let row = 0; row < layout.height + 1; row++) setCell(grid, spineX, y + row, "│", "spine")
    setCell(grid, spineX, y, "●", "spine")
    layout.periodLines.forEach((line, index) => {
      const lineWidth = diagramTextWidth(line)
      setText(grid, leftWidth - lineWidth, y + index, line, "period")
    })
    for (let x = leftWidth + 1; x < spineX; x++) setCell(grid, x, y, "─", "spine")

    let eventY = y
    for (const lines of layout.eventLines) {
      setText(grid, spineX + 1, eventY, BRANCH, "spine")
      lines.forEach((line, index) => setText(grid, spineX + 4, eventY + index, line, "event"))
      eventY += lines.length
    }
    y += layout.height + 1
  }
  return grid
}

function setCell(grid: TimelineGrid, x: number, y: number, char: string, style: TimelineCellStyle): void {
  grid.setCell(x, y, char, style)
}

function setText(grid: TimelineGrid, x: number, y: number, text: string, style: TimelineCellStyle): void {
  grid.setText(x, y, text, style)
}
