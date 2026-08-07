import { RGBA, type ColorInput, type StyledText } from "@opentui/core"
import type { DiagramCanvas, DiagramCanvasRunOptions } from "../core/canvas.js"
import { diagramCellColorKey, mappedDiagramColor } from "../core/color/map.js"
import { renderDiagramGridAnsi, renderDiagramGridStyledText } from "../core/render-grid.js"
import {
  ansiFg,
  createColorRampTheme,
  createAnsiRampTheme,
  DIAGRAM_FADE_STEPS,
  numberedStyleKeys,
  rgba,
  type DiagramFadeStep,
  type DiagramRgb,
} from "../core/color/style.js"

export type FlowchartBaseCellStyle = "node" | "activeNode" | "database" | "edge" | "activeEdge" | "label" | "group"
export type FlowchartNodeEdgeFadeStyle = `nodeEdgeFade${DiagramFadeStep}`
export type FlowchartDatabaseEdgeFadeStyle = `databaseEdgeFade${DiagramFadeStep}`
export type FlowchartEdgeFadeStyle = FlowchartNodeEdgeFadeStyle | FlowchartDatabaseEdgeFadeStyle
export type FlowchartCellStyle = FlowchartBaseCellStyle | FlowchartEdgeFadeStyle
export interface FlowchartCellMetadata {
  nodeId?: string
  bgNodeId?: string
}
export type FlowchartGrid = DiagramCanvas<FlowchartCellStyle, FlowchartCellMetadata>
export type FlowchartStyleColors = Required<Record<FlowchartCellStyle, RGBA>>
export type FlowchartDiagramAnsiTheme = Partial<Record<FlowchartCellStyle, string>>
export type FlowchartNodeColorMap = ReadonlyMap<string, RGBA>
export type FlowchartNodeColors = Record<string, ColorInput | undefined> | ReadonlyMap<string, ColorInput | undefined>

export function flowchartNodeColorKey(nodeId: string, level: number): string {
  return diagramCellColorKey(nodeId, level)
}

export const DEFAULT_THEME_RGB = {
  node: [228, 239, 232],
  activeNode: [221, 255, 246],
  database: [228, 239, 232],
  edge: [134, 225, 200],
  activeEdge: [221, 255, 246],
  label: [134, 225, 200],
  group: [76, 99, 89],
} as const satisfies Record<FlowchartBaseCellStyle, DiagramRgb>

export const NODE_EDGE_FADE_STYLES = numberedStyleKeys("nodeEdgeFade", DIAGRAM_FADE_STEPS)
export const DATABASE_EDGE_FADE_STYLES = numberedStyleKeys("databaseEdgeFade", DIAGRAM_FADE_STEPS)

const DEFAULT_ANSI_THEME: Required<Record<FlowchartCellStyle, string>> = {
  node: ansiFg(DEFAULT_THEME_RGB.node),
  activeNode: ansiFg(DEFAULT_THEME_RGB.activeNode),
  database: ansiFg(DEFAULT_THEME_RGB.database),
  edge: ansiFg(DEFAULT_THEME_RGB.edge),
  activeEdge: ansiFg(DEFAULT_THEME_RGB.activeEdge),
  label: ansiFg(DEFAULT_THEME_RGB.label),
  group: ansiFg(DEFAULT_THEME_RGB.group),
  ...createAnsiRampTheme(NODE_EDGE_FADE_STYLES, DEFAULT_THEME_RGB.node, DEFAULT_THEME_RGB.edge),
  ...createAnsiRampTheme(DATABASE_EDGE_FADE_STYLES, DEFAULT_THEME_RGB.database, DEFAULT_THEME_RGB.edge),
}

export function resolveFlowchartStyleColors(
  colors: Partial<Record<FlowchartCellStyle, RGBA | undefined>> = {},
): FlowchartStyleColors {
  const node = colors.node ?? rgba(DEFAULT_THEME_RGB.node)
  const activeNode = colors.activeNode ?? rgba(DEFAULT_THEME_RGB.activeNode)
  const database = colors.database ?? rgba(DEFAULT_THEME_RGB.database)
  const edge = colors.edge ?? rgba(DEFAULT_THEME_RGB.edge)
  const activeEdge = colors.activeEdge ?? rgba(DEFAULT_THEME_RGB.activeEdge)
  return {
    node,
    activeNode,
    database,
    edge,
    activeEdge,
    label: colors.label ?? rgba(DEFAULT_THEME_RGB.label),
    group: colors.group ?? rgba(DEFAULT_THEME_RGB.group),
    ...createColorRampTheme(NODE_EDGE_FADE_STYLES, node, edge),
    ...createColorRampTheme(DATABASE_EDGE_FADE_STYLES, database, edge),
  }
}

function nodeMappedColor(colors: FlowchartNodeColorMap | undefined, nodeId: string | undefined): RGBA | undefined {
  return mappedDiagramColor(colors, nodeId)
}

export function renderGridStyledText(
  grid: FlowchartGrid,
  colors: FlowchartStyleColors,
  nodeColors?: FlowchartNodeColorMap,
  nodeBgColors?: FlowchartNodeColorMap,
): StyledText {
  const useNodeRuns = Boolean(nodeColors?.size || nodeBgColors?.size)
  const runOptions: DiagramCanvasRunOptions<FlowchartCellStyle, FlowchartCellMetadata> = useNodeRuns
    ? { trimTop: true, trimBottom: true, key: (cell) => [cell.style, cell.nodeId, cell.bgNodeId] }
    : { trimTop: true, trimBottom: true }
  return renderDiagramGridStyledText(
    grid,
    (run) => nodeMappedColor(nodeColors, run.cell.nodeId) ?? (run.style ? colors[run.style] : undefined),
    (run) => nodeMappedColor(nodeBgColors, run.cell.bgNodeId),
    runOptions,
  )
}

export function renderGridAnsi(grid: FlowchartGrid, theme: FlowchartDiagramAnsiTheme = {}): string {
  const resolved = { ...DEFAULT_ANSI_THEME, ...theme }
  return renderDiagramGridAnsi(grid, (run) => (run.style ? resolved[run.style] : undefined), {
    trimTop: true,
    trimBottom: true,
  })
}
