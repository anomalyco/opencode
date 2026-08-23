import { DiagramCanvas } from "../core/canvas.js"
import { diagramTextWidth } from "../core/text.js"
import type { GanttGrid } from "./render-grid.js"
import type { GanttCellStyle, GanttDiagram, GanttDiagramRenderOptions, GanttRenderStyle, GanttTask } from "./types.js"

const LABEL_GAP = 2
const MIN_CHART_WIDTH = 24
const MAX_CHART_WIDTH = 64

export function drawGanttDiagramGrid(diagram: GanttDiagram, options: GanttDiagramRenderOptions = {}): GanttGrid {
  if (diagram.entries.length === 0) return new DiagramCanvas(0, 0)
  const labelWidth = Math.max(
    ...diagram.entries.map((entry) =>
      diagramTextWidth(entry.type === "section" ? entry.section.label : entry.task.label),
    ),
  )
  if (diagram.tasks.length === 0) {
    const grid: GanttGrid = new DiagramCanvas(labelWidth, diagram.entries.length)
    diagram.entries.forEach((entry, index) => {
      if (entry.type === "section") grid.setText(0, index, entry.section.label, "section")
    })
    return grid
  }
  const available = (options.layoutMaxWidth ?? 120) - labelWidth - LABEL_GAP
  const chartWidth = Math.max(MIN_CHART_WIDTH, Math.min(MAX_CHART_WIDTH, available))
  const starts = diagram.tasks.map((task) => task.start)
  const ends = diagram.tasks.map((task) => task.end)
  const minimum = Math.min(...starts)
  const maximum = Math.max(...ends)
  const span = Math.max(1, maximum - minimum)
  const titleHeight = diagram.title ? 2 : 0
  const axisHeight = 2
  const grid: GanttGrid = new DiagramCanvas(
    labelWidth + LABEL_GAP + chartWidth,
    titleHeight + axisHeight + diagram.entries.length,
  )
  const chartX = labelWidth + LABEL_GAP

  if (diagram.title)
    grid.setText(
      Math.max(0, chartX + Math.floor((chartWidth - diagramTextWidth(diagram.title)) / 2)),
      0,
      diagram.title,
      "title",
    )
  drawAxis(grid, chartX, titleHeight, chartWidth, minimum, span, diagram.axisFormat)

  diagram.entries.forEach((entry, index) => {
    const y = titleHeight + axisHeight + index
    if (entry.type === "section") {
      grid.setText(0, y, entry.section.label, "section")
      return
    }
    grid.setText(labelWidth - diagramTextWidth(entry.task.label), y, entry.task.label, entry.task.state)
    drawTask(grid, entry.task, chartX, y, chartWidth, minimum, span, options.style ?? "rail")
  })
  return grid
}

function drawAxis(
  grid: GanttGrid,
  x: number,
  y: number,
  width: number,
  minimum: number,
  span: number,
  format: string,
): void {
  for (let offset = 0; offset < width; offset++) grid.setCell(x + offset, y + 1, "─", "axis")
  const step = tickStep(span)
  const ticks: number[] = []
  for (let value = Math.ceil(minimum / step) * step; value <= minimum + span; value += step) ticks.push(value)
  if (ticks.length === 0) ticks.push(minimum, minimum + span)
  for (const value of ticks) {
    const offset = Math.round(((value - minimum) / span) * (width - 1))
    const label = formatTime(value, format)
    const labelX = Math.max(
      x,
      Math.min(x + width - diagramTextWidth(label), x + offset - Math.floor(diagramTextWidth(label) / 2)),
    )
    grid.setText(labelX, y, label, "axis")
    grid.setCell(x + offset, y + 1, "┬", "axis")
  }
}

function tickStep(span: number): number {
  const steps = [
    1_000, 5_000, 10_000, 30_000, 60_000, 300_000, 900_000, 3_600_000, 21_600_000, 43_200_000, 86_400_000, 172_800_000,
    604_800_000, 2_592_000_000, 31_536_000_000,
  ]
  return steps.find((step) => step >= span / 4) ?? steps.at(-1)!
}

function drawTask(
  grid: GanttGrid,
  task: GanttTask,
  x: number,
  y: number,
  width: number,
  minimum: number,
  span: number,
  style: GanttRenderStyle,
): void {
  const start = Math.round(((task.start - minimum) / span) * (width - 1))
  const end = Math.round(((task.end - minimum) / span) * (width - 1))
  if (task.state === "milestone" || start === end) {
    grid.setCell(x + start, y, "◆", task.state)
    return
  }
  if (style === "track") {
    for (let offset = 0; offset < width; offset++) grid.setCell(x + offset, y, "·", "axis")
  }
  const glyph = style === "block" ? "█" : style === "points" ? "─" : "━"
  for (let offset = start; offset <= end; offset++) grid.setCell(x + offset, y, glyph, task.state)
  if (style === "block") return
  if (style === "capsule" || style === "track") {
    grid.setCell(x + start, y, "╺", task.state)
    grid.setCell(x + end, y, "╸", task.state)
    return
  }
  if (style === "points") {
    grid.setCell(x + start, y, "●", task.state)
    grid.setCell(x + end, y, "●", task.state)
    return
  }
  grid.setCell(x + start, y, "┣", task.state)
  grid.setCell(x + end, y, "┫", task.state)
}

function formatTime(value: number, format: string): string {
  const date = new Date(value)
  const parts: Record<string, string> = {
    "%Y": String(date.getUTCFullYear()),
    "%m": String(date.getUTCMonth() + 1).padStart(2, "0"),
    "%d": String(date.getUTCDate()).padStart(2, "0"),
    "%H": String(date.getUTCHours()).padStart(2, "0"),
    "%M": String(date.getUTCMinutes()).padStart(2, "0"),
    "%S": String(date.getUTCSeconds()).padStart(2, "0"),
  }
  return Object.entries(parts).reduce((result, [token, replacement]) => result.replaceAll(token, replacement), format)
}
