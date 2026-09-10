import { BorderChars, TextAttributes, type BorderCharacters, type BorderStyle } from "@opentui/core"
import { walkOrthogonalSegment, type DiagramDirection } from "../core/geometry.js"
import { DiagramCanvas, type DiagramCanvasCell } from "../core/canvas.js"
import { DIAGRAM_LABEL_PADDING_X, parseDiagramTextLines } from "../core/text.js"
import type { DiagramTextRun } from "../core/text-lines.js"
import {
  DIAGRAM_ARROW_HEADS,
  diagramArrowHeadBetween,
  diagramDiamondCharactersFromBorder,
  diagramLineGlyph,
  drawDiagramDiamond,
  drawDiagramFrame,
  fillDiagramFrameInterior,
  drawOrthogonalPath,
  mergeDiagramLineGlyph,
} from "../core/drawing.js"
import { layoutFlowchartDiagram, visualLength } from "./layout.js"
import { flowchartRouteLabelLayout } from "./labels.js"
import type { FlowchartDiagramRenderOptions } from "./options.js"
import { flowchartDirectionBetween, flowchartSourceConnector } from "./routing.js"
import {
  DATABASE_EDGE_FADE_STYLES,
  NODE_EDGE_FADE_STYLES,
  type FlowchartCellStyle,
  type FlowchartCellMetadata,
  type FlowchartEdgeFadeStyle,
  type FlowchartGrid,
} from "./style.js"
import type {
  FlowchartDiagram,
  FlowchartEdgeRoute,
  FlowchartNode,
  FlowchartNodeBounds,
  FlowchartPoint,
  FlowchartSubgraphBounds,
} from "./types.js"

export const DEFAULT_BORDER_STYLE = "rounded" satisfies BorderStyle
function mergeFlowchartCell(
  existing: DiagramCanvasCell<FlowchartCellStyle>,
  incoming: DiagramCanvasCell<FlowchartCellStyle>,
): DiagramCanvasCell<FlowchartCellStyle> {
  if (incoming.style !== "edge") return incoming
  if (existing.style === "label") return existing
  if (incoming.char === " ") return existing
  if (existing.style !== "edge" || existing.char === " ") return incoming
  if (DIAGRAM_ARROW_HEADS.has(existing.char)) return existing
  if (DIAGRAM_ARROW_HEADS.has(incoming.char)) return incoming

  return {
    ...incoming,
    char: mergeDiagramLineGlyph(existing.char, incoming.char, "rounded") ?? incoming.char,
  } as DiagramCanvasCell<FlowchartCellStyle>
}

function setRichText(
  grid: FlowchartGrid,
  x: number,
  y: number,
  runs: readonly DiagramTextRun[],
  style: FlowchartCellStyle,
): number {
  let offset = 0
  for (const run of runs) {
    grid.setText(x + offset, y, run.text, style, run.italic ? { attributes: TextAttributes.ITALIC } : undefined)
    offset += visualLength(run.text)
  }
  return offset
}

function drawNode(
  grid: FlowchartGrid,
  node: FlowchartNode,
  bounds: FlowchartNodeBounds,
  borderStyle: BorderStyle,
): void {
  const chars = BorderChars[borderStyle]
  const style: FlowchartCellStyle = node.shape === "database" ? "database" : "node"
  const border: FlowchartCellStyle = node.shape === "database" ? "databaseBorder" : "nodeBorder"

  if (node.shape === "decision") {
    drawDiagramDiamond(
      bounds,
      (x, y, char) => grid.setCell(x, y, char, border),
      diagramDiamondCharactersFromBorder(chars),
    )
  } else if (node.shape === "subroutine") {
    fillDiagramFrameInterior(bounds, (x, y) => grid.setCell(x, y, " ", style))
    drawSubroutineNode(grid, bounds, chars, border)
  } else if (node.shape === "database") {
    fillDiagramFrameInterior(bounds, (x, y) => grid.setCell(x, y, " ", style))
    drawDatabaseNode(grid, bounds, chars, border)
  } else {
    fillDiagramFrameInterior(bounds, (x, y) => grid.setCell(x, y, " ", style))
    drawDiagramFrame(bounds, chars, (x, y, char) => grid.setCell(x, y, char, border))
  }

  const textTop =
    node.shape === "decision"
      ? bounds.top + Math.floor((bounds.height - bounds.lines.length) / 2)
      : node.shape === "database"
        ? bounds.top + 2
        : bounds.top + 1
  const lines = parseDiagramTextLines(node.label)
  for (const [index, line] of bounds.lines.entries()) {
    const lineX =
      node.shape === "subroutine"
        ? bounds.left + 3
        : bounds.left + Math.max(1, Math.floor((bounds.width - visualLength(line)) / 2))
    setRichText(grid, lineX, textTop + index, lines[index]!.runs, style)
  }
}

function drawSubroutineNode(
  grid: FlowchartGrid,
  bounds: FlowchartNodeBounds,
  chars: BorderCharacters,
  style: FlowchartCellStyle,
): void {
  drawDiagramFrame(bounds, chars, (x, y, char) => grid.setCell(x, y, char, style))
  const leftRailX = bounds.left + 2
  const rightRailX = bounds.left + bounds.width - 3
  grid.setCell(leftRailX, bounds.top, chars.topT, style)
  grid.setCell(rightRailX, bounds.top, chars.topT, style)
  grid.setCell(leftRailX, bounds.top + bounds.height - 1, chars.bottomT, style)
  grid.setCell(rightRailX, bounds.top + bounds.height - 1, chars.bottomT, style)
  for (let y = bounds.top + 1; y < bounds.top + bounds.height - 1; y++) {
    grid.setCell(leftRailX, y, chars.vertical, style)
    grid.setCell(rightRailX, y, chars.vertical, style)
  }
}

function drawDatabaseNode(
  grid: FlowchartGrid,
  bounds: FlowchartNodeBounds,
  chars: BorderCharacters,
  style: FlowchartCellStyle,
): void {
  drawDiagramFrame(bounds, chars, (x, y, char) => grid.setCell(x, y, char, style))
  const topRailY = bounds.top + 1
  const bottomRailY = bounds.top + bounds.height - 2
  for (const y of [topRailY, bottomRailY]) {
    grid.setCell(bounds.left, y, chars.leftT, style)
    grid.setCell(bounds.left + bounds.width - 1, y, chars.rightT, style)
    for (let x = bounds.left + 1; x < bounds.left + bounds.width - 1; x++) {
      grid.setCell(x, y, chars.horizontal, style)
    }
  }
}

function drawSubgraphFrame(grid: FlowchartGrid, bounds: FlowchartSubgraphBounds, borderStyle: BorderStyle): void {
  const chars = BorderChars[borderStyle]
  drawDiagramFrame(bounds, chars, (x, y, char) => grid.setCell(x, y, char, "group"))
}

function drawSubgraphLabel(grid: FlowchartGrid, bounds: FlowchartSubgraphBounds): void {
  if (bounds.label) {
    const lines = parseDiagramTextLines(bounds.label)
    const labelY = bounds.labelSide === "top" ? bounds.top : bounds.top + bounds.height - lines.length
    for (const [index, line] of lines.entries()) {
      grid.setText(bounds.left + 2, labelY + index, " ", "groupLabel")
      const width = setRichText(grid, bounds.left + 3, labelY + index, line.runs, "groupLabel")
      grid.setText(bounds.left + width + 3, labelY + index, " ", "groupLabel")
    }
  }
}

function drawEdgeLabel(grid: FlowchartGrid, route: FlowchartEdgeRoute, style: FlowchartCellStyle): void {
  const label = flowchartRouteLabelLayout(route, visualLength)
  const padding = " ".repeat(DIAGRAM_LABEL_PADDING_X)
  for (const [index, line] of parseDiagramTextLines(route.edge.label).entries()) {
    grid.setText(label.point.x, label.point.y + index, padding, style)
    const width = setRichText(grid, label.point.x + DIAGRAM_LABEL_PADDING_X, label.point.y + index, line.runs, style)
    grid.setText(label.point.x + width + DIAGRAM_LABEL_PADDING_X, label.point.y + index, padding, style)
  }
}

function drawRoutedEdge(grid: FlowchartGrid, route: FlowchartEdgeRoute): void {
  const { edge, points } = route
  if (points.length < 2) return
  const style: FlowchartCellStyle = "edge"

  drawOrthogonalPath(points, (x, y, char) => grid.setCell(x, y, char, style), {
    cornerStyle: "rounded",
    lineStyle: edge.style === "thick" ? "heavy" : "single",
  })
  if (edge.arrowhead !== false) {
    const end = points[points.length - 1]!
    const arrowFrom = points[points.length - 2]!
    grid.setCell(end.x, end.y, diagramArrowHeadBetween(arrowFrom, end), style)
  } else {
    const end = points[points.length - 1]!
    const endDirection = flowchartDirectionBetween(points[points.length - 2]!, end)
    if (endDirection) grid.setCell(end.x, end.y, diagramLineGlyph(new Set([endDirection])), style)
  }
  if (edge.label) {
    drawEdgeLabel(grid, route, "label")
  }
}

function flowchartNodeStyle(node: FlowchartNode | undefined): "node" | "database" {
  return node?.shape === "database" ? "database" : "node"
}

function sourceFadeStyles(sourceStyle: "node" | "database"): readonly FlowchartEdgeFadeStyle[] {
  return sourceStyle === "database" ? DATABASE_EDGE_FADE_STYLES : NODE_EDGE_FADE_STYLES
}

function styleExistingEdgeCell(grid: FlowchartGrid, x: number, y: number, style: FlowchartEdgeFadeStyle): void {
  const cell = grid.getCell(x, y)
  if (cell) grid.setCell(x, y, cell.char, style)
}

function routeCellOccupancy(routes: readonly FlowchartEdgeRoute[]): Map<string, number> {
  const occupancy = new Map<string, number>()
  for (const route of routes) {
    const routeCells = new Set<string>()
    for (let index = 1; index < route.points.length; index++) {
      walkOrthogonalSegment(route.points[index - 1]!, route.points[index]!, index === 1, (point) => {
        routeCells.add(`${point.x}:${point.y}`)
      })
    }
    for (const key of routeCells) occupancy.set(key, (occupancy.get(key) ?? 0) + 1)
  }
  return occupancy
}

function fadeSourcePath(
  grid: FlowchartGrid,
  connector: FlowchartPoint,
  points: FlowchartPoint[],
  styles: readonly FlowchartEdgeFadeStyle[],
  occupancy: ReadonlyMap<string, number>,
): void {
  const from = points[0]
  const to = points[1]
  if (!from || !to) return
  const privateCells = [connector]

  walkOrthogonalSegment(from, to, true, (point) => {
    const key = `${point.x}:${point.y}`
    const cell = grid.getCell(point.x, point.y)
    if (occupancy.get(key) !== 1 || !cell || !"─━│┃".includes(cell.char) || cell.style === "label") return false
    privateCells.push(point)
  })

  for (const [index, point] of privateCells.entries()) {
    const styleIndex = Math.min(
      styles.length - 1,
      Math.floor(((index + 1) * styles.length) / (privateCells.length + 1)),
    )
    styleExistingEdgeCell(grid, point.x, point.y, styles[styleIndex]!)
  }
}

function drawSourceConnectors(
  grid: FlowchartGrid,
  diagram: FlowchartDiagram,
  bounds: Map<string, FlowchartNodeBounds>,
  routes: readonly FlowchartEdgeRoute[],
): void {
  const nodesById = new Map(diagram.nodes.map((node) => [node.id, node]))
  const occupancy = routeCellOccupancy(routes)
  const sourceJunctions = new Map<string, { directions: Set<DiagramDirection>; heavy: boolean }>()
  for (const route of routes) {
    const sourcePoint = route.points[0]
    const next = route.points[1]
    if (!sourcePoint || !next) continue
    const key = `${route.edge.from}:${sourcePoint.x}:${sourcePoint.y}`
    const direction = flowchartDirectionBetween(sourcePoint, next)
    const junction = sourceJunctions.get(key) ?? { directions: new Set<DiagramDirection>(), heavy: true }
    if (direction) junction.directions.add(direction)
    junction.heavy &&= route.edge.style === "thick"
    sourceJunctions.set(key, junction)
  }

  for (const route of routes) {
    const from = bounds.get(route.edge.from)
    const sourcePoint = route.points[0]
    if (!from || !sourcePoint) continue
    const styles = sourceFadeStyles(flowchartNodeStyle(nodesById.get(route.edge.from)))
    const connector = flowchartSourceConnector(from, sourcePoint)
    grid.setCell(connector.x, connector.y, connector.char, "edge")
    const connectorDirection = flowchartDirectionBetween(sourcePoint, connector)
    if (connectorDirection) {
      const cell = grid.getCell(sourcePoint.x, sourcePoint.y)
      if (cell && cell.style !== "label" && !DIAGRAM_ARROW_HEADS.has(cell.char)) {
        const key = `${route.edge.from}:${sourcePoint.x}:${sourcePoint.y}`
        const junction = sourceJunctions.get(key)
        const directions = new Set(junction?.directions)
        directions.add(connectorDirection)
        grid.replaceCell(
          sourcePoint.x,
          sourcePoint.y,
          diagramLineGlyph(
            directions,
            "rounded",
            (junction?.heavy ?? route.edge.style === "thick") ? "heavy" : "single",
          ),
          "edge",
        )
      }
    }
    if (nodesById.has(route.edge.from)) fadeSourcePath(grid, connector, route.points, styles, occupancy)
    if (route.edge.sourceArrowhead && route.points[1]) {
      grid.setCell(sourcePoint.x, sourcePoint.y, diagramArrowHeadBetween(sourcePoint, connector), "edge")
    }
  }
}

export function drawFlowchartDiagramGrid(
  diagram: FlowchartDiagram,
  options: FlowchartDiagramRenderOptions = {},
): FlowchartGrid {
  const borderStyle = options.borderStyle ?? DEFAULT_BORDER_STYLE
  const layout = layoutFlowchartDiagram(diagram, options)
  const { bounds, routes, subgraphBounds, width, height } = layout
  diagram = layout.diagram
  const grid = new DiagramCanvas<FlowchartCellStyle, FlowchartCellMetadata>(width, height, {
    mergeCell: mergeFlowchartCell,
  })
  for (const subgraph of diagram.subgraphs ?? []) {
    const bound = subgraphBounds.get(subgraph.id)
    if (bound) drawSubgraphFrame(grid, bound, borderStyle)
  }
  for (const route of routes) drawRoutedEdge(grid, route)
  for (const node of diagram.nodes) {
    const bound = bounds.get(node.id)
    if (bound) drawNode(grid, node, bound, borderStyle)
  }
  drawSourceConnectors(
    grid,
    diagram,
    new Map([
      ...bounds,
      ...[...subgraphBounds].map(
        ([id, frame]) => [id, { ...frame, lines: [] }] satisfies [string, FlowchartNodeBounds],
      ),
    ]),
    routes,
  )
  for (const subgraph of diagram.subgraphs ?? []) {
    const bound = subgraphBounds.get(subgraph.id)
    if (bound) drawSubgraphLabel(grid, bound)
  }

  return grid
}
