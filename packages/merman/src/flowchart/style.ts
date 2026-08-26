import { RGBA, type StyledText } from "@opentui/core"
import type { DiagramCanvas } from "../core/canvas.js"
import { renderDiagramGridStyledTextByStyle } from "../core/render-grid.js"
import {
  createColorRampTheme,
  DIAGRAM_FADE_STEPS,
  numberedStyleKeys,
  rgba,
  type DiagramFadeStep,
  type DiagramRgb,
} from "../core/color/style.js"

export type FlowchartBaseCellStyle =
  | "node"
  | "nodeBorder"
  | "database"
  | "databaseBorder"
  | "edge"
  | "label"
  | "group"
  | "groupLabel"
export type FlowchartNodeEdgeFadeStyle = `nodeEdgeFade${DiagramFadeStep}`
export type FlowchartDatabaseEdgeFadeStyle = `databaseEdgeFade${DiagramFadeStep}`
export type FlowchartEdgeFadeStyle = FlowchartNodeEdgeFadeStyle | FlowchartDatabaseEdgeFadeStyle
export type FlowchartCellStyle = FlowchartBaseCellStyle | FlowchartEdgeFadeStyle
export interface FlowchartCellMetadata {
  attributes?: number
}
export type FlowchartGrid = DiagramCanvas<FlowchartCellStyle, FlowchartCellMetadata>
export type FlowchartStyleColors = Required<Record<FlowchartCellStyle, RGBA>>
export type FlowchartStyleBackgroundColors = Partial<Record<FlowchartCellStyle, RGBA>>
export const DEFAULT_THEME_RGB = {
  node: [228, 239, 232],
  nodeBorder: [141, 163, 151],
  database: [228, 239, 232],
  databaseBorder: [141, 163, 151],
  edge: [134, 225, 200],
  label: [134, 225, 200],
  group: [76, 99, 89],
  groupLabel: [76, 99, 89],
} as const satisfies Record<FlowchartBaseCellStyle, DiagramRgb>

export const NODE_EDGE_FADE_STYLES = numberedStyleKeys("nodeEdgeFade", DIAGRAM_FADE_STEPS)
export const DATABASE_EDGE_FADE_STYLES = numberedStyleKeys("databaseEdgeFade", DIAGRAM_FADE_STEPS)

export function resolveFlowchartStyleColors(
  colors: Partial<Record<FlowchartCellStyle, RGBA | undefined>> = {},
): FlowchartStyleColors {
  const node = colors.node ?? rgba(DEFAULT_THEME_RGB.node)
  const nodeBorder = colors.nodeBorder ?? rgba(DEFAULT_THEME_RGB.nodeBorder)
  const database = colors.database ?? rgba(DEFAULT_THEME_RGB.database)
  const databaseBorder = colors.databaseBorder ?? rgba(DEFAULT_THEME_RGB.databaseBorder)
  const edge = colors.edge ?? rgba(DEFAULT_THEME_RGB.edge)
  return {
    node,
    nodeBorder,
    database,
    databaseBorder,
    edge,
    label: colors.label ?? rgba(DEFAULT_THEME_RGB.label),
    group: colors.group ?? rgba(DEFAULT_THEME_RGB.group),
    groupLabel: colors.groupLabel ?? colors.group ?? rgba(DEFAULT_THEME_RGB.groupLabel),
    ...createColorRampTheme(NODE_EDGE_FADE_STYLES, nodeBorder, edge),
    ...createColorRampTheme(DATABASE_EDGE_FADE_STYLES, databaseBorder, edge),
  }
}

export function renderGridStyledText(
  grid: FlowchartGrid,
  colors: FlowchartStyleColors,
  backgrounds?: FlowchartStyleBackgroundColors,
): StyledText {
  return renderDiagramGridStyledTextByStyle(grid, colors, backgrounds, {
    key: (cell) => [cell.style, cell.attributes],
    attributes: (run) => run.cell.attributes,
    trimTop: true,
    trimBottom: true,
  })
}
