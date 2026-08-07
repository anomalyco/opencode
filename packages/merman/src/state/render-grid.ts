import type { RGBA, StyledText } from "@opentui/core"
import type { DiagramCanvas, DiagramCanvasRunOptions } from "../core/canvas.js"
import { renderDiagramGridAnsi, renderDiagramGridStyledText } from "../core/render-grid.js"
import { resolveStateAnsiTheme, stateStyleBgColor, stateStyleColor, type StateStyleColors } from "./style.js"
import type { StateCellStyle, StateDiagramAnsiTheme } from "./types.js"

export interface StateCellMetadata {
  stateId?: string
  bgStateId?: string
}

export type StateGrid = DiagramCanvas<StateCellStyle, StateCellMetadata>

export function renderStateGridText(grid: StateGrid): string {
  return grid.toString({ trimBottom: true })
}

export function renderStateGridStyledText(
  grid: StateGrid,
  colors: StateStyleColors,
  stateColors?: ReadonlyMap<string, RGBA>,
  stateBgColors?: ReadonlyMap<string, RGBA>,
): StyledText {
  const useStateRuns = Boolean(stateColors?.size || stateBgColors?.size)
  const runOptions: DiagramCanvasRunOptions<StateCellStyle, StateCellMetadata> = useStateRuns
    ? { trimBottom: true, key: (cell) => [cell.style, cell.stateId, cell.bgStateId] }
    : { trimBottom: true }

  return renderDiagramGridStyledText(
    grid,
    (run) => stateStyleColor(run.style, colors, stateColors, useStateRuns ? run.cell.stateId : undefined),
    (run) => stateStyleBgColor(stateBgColors, useStateRuns ? run.cell.bgStateId : undefined),
    runOptions,
  )
}

export function renderStateGridAnsi(grid: StateGrid, theme: StateDiagramAnsiTheme = {}): string {
  const resolved = resolveStateAnsiTheme(theme)
  return renderDiagramGridAnsi(grid, (run) => (run.style ? resolved[run.style] : undefined), {
    trimBottom: true,
  })
}
