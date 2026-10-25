import { DiagramCanvas } from "../core/canvas.js"
import { splitDiagramLines } from "../core/text-lines.js"
import { diagramTextWidth } from "../core/text.js"
import type { TimelineGrid } from "./render-grid.js"
import { TIMELINE_PERIOD_FADE_STYLES, TIMELINE_SECTION_FADE_STYLES } from "./style.js"
import type { TimelineCellStyle, TimelineDiagram, TimelineDiagramRenderOptions, TimelinePeriod } from "./types.js"

interface PeriodLayout {
  period: TimelinePeriod
  periodLines: string[]
  eventLines: string[][]
  height: number
}

const JOIN_WIDTH = TIMELINE_SECTION_FADE_STYLES.length
const SPINE_OFFSET = JOIN_WIDTH + 1
const EVENT_OFFSET = 3

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
      for (const line of lines) leftWidth = Math.max(leftWidth, diagramTextWidth(line))
      continue
    }
    const periodLines = splitDiagramLines(entry.period.period)
    const eventLines = entry.period.events.map(splitDiagramLines)
    const eventHeight = eventLines.reduce((height, lines) => height + lines.length, 0)
    const height = Math.max(periodLines.length, eventHeight)
    periodLayouts.set(entry.period, { period: entry.period, periodLines, eventLines, height })
    for (const line of periodLines) leftWidth = Math.max(leftWidth, diagramTextWidth(line))
    for (const lines of eventLines) {
      for (const line of lines) rightWidth = Math.max(rightWidth, diagramTextWidth(line))
    }
    bodyHeight += height + 1
  }

  const titleLines = diagram.title ? splitDiagramLines(diagram.title) : []
  const bodyWidth = diagram.entries.length === 0 ? 0 : leftWidth + SPINE_OFFSET + EVENT_OFFSET + rightWidth + 1
  let titleWidth = 0
  for (const line of titleLines) titleWidth = Math.max(titleWidth, diagramTextWidth(line))
  const width = Math.max(bodyWidth, titleWidth)
  const titleHeight = titleLines.length === 0 ? 0 : titleLines.length + (diagram.entries.length === 0 ? 0 : 1)
  if (width === 0) return new DiagramCanvas(0, 0)

  const grid: TimelineGrid = new DiagramCanvas(width, titleHeight + bodyHeight)
  titleLines.forEach((line, index) =>
    setText(grid, Math.floor((width - diagramTextWidth(line)) / 2), index, line, "title"),
  )
  if (diagram.entries.length === 0) return grid

  const spineX = leftWidth + SPINE_OFFSET
  let y = titleHeight
  let railStarted = false
  for (const entry of diagram.entries) {
    if (entry.type === "section") {
      const lines = splitDiagramLines(entry.section.label)
      lines.forEach((line, index) => {
        setText(grid, leftWidth - diagramTextWidth(line), y + index, line, "section")
        if (index > 0) setCell(grid, spineX, y + index, "│", "spine")
      })
      drawJoin(grid, leftWidth, y, TIMELINE_SECTION_FADE_STYLES)
      setCell(grid, spineX, y, railStarted ? "┤" : "┐", "spine")
      setCell(grid, spineX, y + lines.length, "│", "spine")
      railStarted = true
      y += lines.length + 1
      continue
    }

    const layout = periodLayouts.get(entry.period)!
    for (let row = 0; row < layout.height + 1; row++) setCell(grid, spineX, y + row, "│", "spine")
    railStarted = true
    setCell(grid, spineX, y, "●", "spine")
    layout.periodLines.forEach((line, index) => {
      const lineWidth = diagramTextWidth(line)
      setText(grid, leftWidth - lineWidth, y + index, line, "period")
    })
    drawJoin(grid, leftWidth, y, TIMELINE_PERIOD_FADE_STYLES)

    let eventY = y
    for (const lines of layout.eventLines) {
      lines.forEach((line, index) => setText(grid, spineX + EVENT_OFFSET, eventY + index, line, "event"))
      eventY += lines.length
    }
    y += layout.height + 1
  }
  return grid
}

function drawJoin(grid: TimelineGrid, x: number, y: number, styles: readonly TimelineCellStyle[]): void {
  styles.forEach((style, index) => setCell(grid, x + index + 1, y, "─", style))
}

function setCell(grid: TimelineGrid, x: number, y: number, char: string, style: TimelineCellStyle): void {
  grid.setCell(x, y, char, style)
}

function setText(grid: TimelineGrid, x: number, y: number, text: string, style: TimelineCellStyle): void {
  grid.setText(x, y, text, style)
}
