import { BorderChars, type BorderCharacters, type BorderStyle } from "@opentui/core"
import { walkOrthogonalSegment } from "../core/geometry.js"
import { DiagramCanvas, type DiagramCanvasCell } from "../core/canvas.js"
import { splitDiagramLines } from "../core/text.js"
import {
  DIAGRAM_ARROW_HEADS,
  diagramArrowHeadBetween,
  diagramDiamondCharactersFromBorder,
  diagramLineGlyph,
  drawDiagramDiamond,
  drawDiagramFrame,
  drawOrthogonalPath,
  mergeDiagramLineGlyph,
} from "../core/drawing.js"
import { layoutFlowchartDiagram, visualLength } from "./layout.js"
import { flowchartEdgeLabelLayout } from "./labels.js"
import type { FlowchartDiagramRenderOptions } from "./options.js"
import { flowchartDirectionBetween, flowchartSourceConnector } from "./routing.js"
import {
  DATABASE_EDGE_FADE_STYLES,
  NODE_EDGE_FADE_STYLES,
  type FlowchartCellStyle,
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
  if (DIAGRAM_ARROW_HEADS.has(existing.char) || DIAGRAM_ARROW_HEADS.has(incoming.char)) return incoming

  return {
    ...incoming,
    char: mergeDiagramLineGlyph(existing.char, incoming.char, "rounded") ?? incoming.char,
  } as DiagramCanvasCell<FlowchartCellStyle>
}

function setNodeText(grid: FlowchartGrid, x: number, y: number, text: string, style: FlowchartCellStyle): void {
  grid.setText(x, y, text, style)
}

function fillNodeInterior(grid: FlowchartGrid, bounds: FlowchartNodeBounds, style: FlowchartCellStyle): void {
  for (let y = bounds.top + 1; y < bounds.top + bounds.height - 1; y++) {
    for (let x = bounds.left + 1; x < bounds.left + bounds.width - 1; x++) {
      grid.setCell(x, y, " ", style)
    }
  }
}

function drawNode(
  grid: FlowchartGrid,
  node: FlowchartNode,
  bounds: FlowchartNodeBounds,
  borderStyle: BorderStyle,
): void {
  const chars = BorderChars[borderStyle]
  const style: FlowchartCellStyle = node.shape === "database" ? "database" : "node"

  if (node.shape === "decision") {
    drawDiagramDiamond(
      bounds,
      (x, y, char) => grid.setCell(x, y, char, style),
      diagramDiamondCharactersFromBorder(chars),
    )
  } else if (node.shape === "subroutine") {
    fillNodeInterior(grid, bounds, style)
    drawSubroutineNode(grid, bounds, chars, style)
  } else if (node.shape === "database") {
    fillNodeInterior(grid, bounds, style)
    drawDatabaseNode(grid, bounds, chars, style)
  } else {
    fillNodeInterior(grid, bounds, style)
    drawDiagramFrame(bounds, chars, (x, y, char) => grid.setCell(x, y, char, style))
  }

  const textTop =
    node.shape === "decision"
      ? bounds.top + Math.floor((bounds.height - bounds.lines.length) / 2)
      : node.shape === "database"
        ? bounds.top + 2
        : bounds.top + 1
  for (const [index, line] of bounds.lines.entries()) {
    const lineX =
      node.shape === "subroutine"
        ? bounds.left + 3
        : bounds.left + Math.max(1, Math.floor((bounds.width - visualLength(line)) / 2))
    setNodeText(grid, lineX, textTop + index, line, style)
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
    const lines = splitDiagramLines(bounds.label)
    const labelY = bounds.labelSide === "top" ? bounds.top : bounds.top + bounds.height - lines.length
    for (const [index, line] of lines.entries()) {
      grid.setText(bounds.left + 2, labelY + index, ` ${line} `, "group")
    }
  }
}

function drawEdgeLabel(grid: FlowchartGrid, route: FlowchartEdgeRoute, style: FlowchartCellStyle): void {
  const label = flowchartEdgeLabelLayout(route.points, route.edge.label, visualLength)
  for (const [index, line] of label.lines.entries()) {
    grid.setText(label.point.x, label.point.y + index, line, style)
  }
}

function drawRoutedEdge(grid: FlowchartGrid, route: FlowchartEdgeRoute): void {
  const { edge, points } = route
  if (points.length < 2) return
  const style: FlowchartCellStyle = "edge"

  drawOrthogonalPath(points, (x, y, char) => grid.setCell(x, y, char, style), {
    cornerStyle: "rounded",
    lineStyle: edge.style === "thick" ? "heavy" : edge.style === "dashed" ? "dashed" : "single",
  })
  const end = points[points.length - 1]!
  const arrowFrom = points[points.length - 2]!
  grid.setCell(end.x, end.y, diagramArrowHeadBetween(arrowFrom, end), style)
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

function styleExistingEdgeCell(grid: FlowchartGrid, x: number, y: number, style: FlowchartEdgeFadeStyle): boolean {
  const cell = grid.getCell(x, y)
  if (!cell || cell.char === " " || cell.style === "label" || DIAGRAM_ARROW_HEADS.has(cell.char)) return false
  grid.setCell(x, y, cell.char, style)
  return true
}

function fadeSourcePath(
  grid: FlowchartGrid,
  points: FlowchartPoint[],
  styles: readonly FlowchartEdgeFadeStyle[],
): void {
  let styleIndex = 1
  const seen = new Set<string>()

  for (let index = 1; index < points.length && styleIndex < styles.length; index++) {
    const from = points[index - 1]!
    const to = points[index]!
    const direction = flowchartDirectionBetween(from, to)
    if (!direction) continue
    walkOrthogonalSegment(from, to, index === 1, (point) => {
      if (styleIndex >= styles.length) return false
      const key = `${point.x}:${point.y}`
      if (!seen.has(key)) {
        seen.add(key)
        if (styleExistingEdgeCell(grid, point.x, point.y, styles[styleIndex]!)) styleIndex += 1
      }
      return styleIndex < styles.length
    })
  }
}

function drawSourceConnectors(
  grid: FlowchartGrid,
  diagram: FlowchartDiagram,
  bounds: Map<string, FlowchartNodeBounds>,
  routes: readonly FlowchartEdgeRoute[],
): void {
  const nodesById = new Map(diagram.nodes.map((node) => [node.id, node]))

  for (const route of routes) {
    const from = bounds.get(route.edge.from)
    const sourcePoint = route.points[0]
    if (!from || !sourcePoint) continue
    const styles = sourceFadeStyles(flowchartNodeStyle(nodesById.get(route.edge.from)))
    const connector = flowchartSourceConnector(from, sourcePoint)
    grid.setCell(connector.x, connector.y, connector.char, styles[0])
    const routeDirection = route.points[1] ? flowchartDirectionBetween(sourcePoint, route.points[1]!) : undefined
    const connectorDirection = flowchartDirectionBetween(sourcePoint, connector)
    if (routeDirection && connectorDirection) {
      const cell = grid.getCell(sourcePoint.x, sourcePoint.y)
      if (cell) {
        cell.char = diagramLineGlyph(
          new Set([routeDirection, connectorDirection]),
          "rounded",
          route.edge.style === "thick" ? "heavy" : "single",
        )
        cell.style = "edge"
      }
    }
    fadeSourcePath(grid, route.points, styles)
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
  const grid = new DiagramCanvas<FlowchartCellStyle>(width, height, {
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
  drawSourceConnectors(grid, diagram, bounds, routes)
  for (const subgraph of diagram.subgraphs ?? []) {
    const bound = subgraphBounds.get(subgraph.id)
    if (bound) drawSubgraphLabel(grid, bound)
  }

  return grid
}
