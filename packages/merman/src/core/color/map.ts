import { parseColor, RGBA, type ColorInput } from "@opentui/core"
import { colorsEqual } from "./style.js"

export type DiagramColorMapInput = Record<string, ColorInput | undefined> | ReadonlyMap<string, ColorInput | undefined>

export const DIAGRAM_CELL_COLOR_LEVEL_SEPARATOR = "::cell:"
export const DIAGRAM_CELL_COLOR_LEVEL_COUNT = 6

export function diagramCellColorKey(id: string, level: number): string {
  const normalizedLevel = Math.max(0, Math.min(DIAGRAM_CELL_COLOR_LEVEL_COUNT - 1, Math.round(level)))
  return `${id}${DIAGRAM_CELL_COLOR_LEVEL_SEPARATOR}${normalizedLevel}`
}

export function diagramRadialCellColorLevel(
  bounds: { width: number; height: number; centerX: number; centerY: number },
  x: number,
  y: number,
  border = false,
): number {
  const halfWidth = Math.max(1, (bounds.width - 1) / 2)
  const halfHeight = Math.max(1, (bounds.height - 1) / 2)
  const dx = (x - bounds.centerX) / halfWidth
  const dy = (y - bounds.centerY) / halfHeight
  const distance = Math.sqrt(dx * dx + dy * dy)
  const level = Math.round((1 - Math.min(1, distance)) * (DIAGRAM_CELL_COLOR_LEVEL_COUNT - 1))
  return border ? Math.min(1, level) : level
}

export function baseDiagramCellColorKey(id: string): string {
  const index = id.lastIndexOf(DIAGRAM_CELL_COLOR_LEVEL_SEPARATOR)
  return index === -1 ? id : id.slice(0, index)
}

export function mappedDiagramColor(
  colors: ReadonlyMap<string, RGBA> | undefined,
  id: string | undefined,
): RGBA | undefined {
  return id ? (colors?.get(id) ?? colors?.get(baseDiagramCellColorKey(id))) : undefined
}

export function normalizeDiagramColorMap(value: DiagramColorMapInput | undefined): Map<string, RGBA> {
  const colors = new Map<string, RGBA>()
  if (!value) return colors

  const entries = value instanceof Map ? value.entries() : Object.entries(value)
  for (const [id, color] of entries) {
    if (color !== undefined) colors.set(id, parseColor(color))
  }

  return colors
}

export function diagramColorMapsEqual(left: ReadonlyMap<string, RGBA>, right: ReadonlyMap<string, RGBA>): boolean {
  if (left.size !== right.size) return false
  for (const [id, color] of left) {
    if (!colorsEqual(color, right.get(id))) return false
  }
  return true
}
