import { BorderChars, TextAttributes } from "@opentui/core"
import { DiagramCanvas, type DiagramCanvasCell } from "../core/canvas.js"
import {
  DIAGRAM_ARROW_HEADS,
  diagramArrowHead,
  diagramLineGlyph,
  drawDiagramFrame,
  drawOrthogonalPath,
  mergeDiagramLineGlyph,
} from "../core/drawing.js"
import {
  directionBetween,
  point,
  translateDiagramBounds,
  walkOrthogonalSegment,
  type DiagramDirection,
  type DiagramPoint,
} from "../core/geometry.js"
import { diagramTextWidth, parseDiagramTextLines, DIAGRAM_LABEL_PADDING_X } from "../core/text.js"
import { flowchartRouteLabelLayout } from "../flowchart/labels.js"
import { layoutFlowchartDiagram, type FlowchartLayout } from "../flowchart/layout.js"
import { flowchartSourceConnector } from "../flowchart/routing.js"
import type { FlowchartDiagram, FlowchartEdgeRoute, FlowchartNodeBounds } from "../flowchart/types.js"
import type {
  ClassCellStyle,
  ClassDiagram,
  ClassDiagramRenderOptions,
  ClassNode,
  ClassRelation,
  ClassRelationMarker,
} from "./types.js"

export type ClassGrid = DiagramCanvas<ClassCellStyle, { attributes?: number }>

const BORDER = BorderChars.rounded
const SEPARATOR = "\u0000"
const MARKERS = new Set(["△", "▽", "◁", "▷", "◆", "◇"])

export function drawClassDiagramGrid(diagram: ClassDiagram, options: ClassDiagramRenderOptions = {}): ClassGrid {
  const layoutOptions = { compact: options.compact, layoutMaxWidth: options.layoutMaxWidth, separateLooseNodes: true }
  const firstLayout = layoutFlowchartDiagram(toFlowchart(diagram, new Map()), layoutOptions)
  const padding = rowPadding(firstLayout.bounds)
  const layout = padding.size ? layoutFlowchartDiagram(toFlowchart(diagram, padding), layoutOptions) : firstLayout
  straightenLeafRoutes(layout, new Set(diagram.namespaces.flatMap((namespace) => namespace.classIds)))
  const first = drawLayout(diagram, layout, padding)
  if (!first.dropped) return first.grid
  // A cardinality had no free cell, usually because its line ends at the canvas edge. Add a margin and redraw.
  const margin =
    Math.max(
      ...diagram.relations
        .flatMap((relation) => [relation.fromCardinality ?? "", relation.toCardinality ?? ""])
        .map(diagramTextWidth),
    ) + 2
  translateLayout(layout, margin, 1)
  layout.width += margin * 2
  layout.height += 2
  return drawLayout(diagram, layout, padding).grid
}

function translateLayout(layout: FlowchartLayout, dx: number, dy: number): void {
  for (const bounds of [...layout.bounds.values(), ...layout.subgraphBounds.values()])
    translateDiagramBounds(bounds, dx, dy)
  for (const route of layout.routes) {
    route.points = route.points.map((routePoint) => point(routePoint.x + dx, routePoint.y + dy))
    if (route.labelPoint) route.labelPoint = point(route.labelPoint.x + dx, route.labelPoint.y + dy)
  }
}

function drawLayout(
  diagram: ClassDiagram,
  layout: FlowchartLayout,
  padding: ReadonlyMap<string, number>,
): { grid: ClassGrid; dropped: boolean } {
  const relations = new Map<string, ClassRelation[]>()
  for (const relation of diagram.relations) {
    const key = relationKey(relation.from, relation.to, relation.label)
    relations.set(key, [...(relations.get(key) ?? []), relation])
  }
  const grid: ClassGrid = new DiagramCanvas(layout.width, layout.height, { mergeCell })

  for (const bounds of layout.subgraphBounds.values()) {
    drawDiagramFrame(bounds, BORDER, (x, y, char) => grid.setCell(x, y, char, "namespace"))
  }
  const drawn = layout.routes.flatMap((route) => {
    const relation = relations.get(relationKey(route.edge.from, route.edge.to, route.edge.label))?.shift()
    return relation ? [{ route, relation }] : []
  })
  for (const entry of drawn) drawRelation(grid, entry.route, entry.relation)
  for (const node of diagram.classes) {
    const bounds = layout.bounds.get(node.id)
    if (bounds) drawClass(grid, node, bounds, padding.get(node.id) ?? 0)
  }
  // Unmarked ends join the box border, as markers already sit against it.
  for (const { route, relation } of drawn) {
    const ends = [
      { bounds: layout.bounds.get(route.edge.from), point: route.points[0], marker: relation.fromMarker },
      { bounds: layout.bounds.get(route.edge.to), point: route.points.at(-1), marker: relation.toMarker },
    ]
    for (const end of ends) {
      if (!end.bounds || !end.point || end.marker) continue
      const connector = flowchartSourceConnector(end.bounds, end.point)
      grid.replaceCell(connector.x, connector.y, connector.char, "classBorder")
    }
  }
  let dropped = false
  // Lines that share an end point show a shared cardinality once.
  const placed = new Set<string>()
  for (const { route, relation } of drawn) {
    const points = route.points
    if (points.length < 2) continue
    const ends = [
      { point: points[0]!, neighbor: points[1]!, text: relation.fromCardinality },
      { point: points.at(-1)!, neighbor: points.at(-2)!, text: relation.toCardinality },
    ]
    for (const end of ends) {
      const key = `${end.point.x}:${end.point.y}:${end.text}`
      if (!end.text || placed.has(key)) continue
      placed.add(key)
      dropped = !drawCardinality(grid, end.point, end.neighbor, end.text) || dropped
    }
  }
  for (const bounds of layout.subgraphBounds.values()) {
    grid.setText(bounds.left + 2, bounds.top, ` ${bounds.label} `, "namespaceLabel")
  }
  return { grid, dropped }
}

function toFlowchart(diagram: ClassDiagram, padding: ReadonlyMap<string, number>): FlowchartDiagram {
  return {
    direction: diagram.direction,
    nodes: diagram.classes.map((node) => ({
      id: node.id,
      label: classLines(node, padding.get(node.id) ?? 0).join("<br>"),
      shape: "box",
    })),
    edges: diagram.relations.map((relation) => ({ from: relation.from, to: relation.to, label: relation.label })),
    subgraphs: diagram.namespaces.map((namespace) => ({
      id: namespace.id,
      label: namespace.id,
      nodeIds: namespace.classIds,
    })),
  }
}

/** Boxes sharing a layout row get equal heights so their tops and bottoms line up. */
function rowPadding(bounds: ReadonlyMap<string, FlowchartNodeBounds>): Map<string, number> {
  // Rows are centered on a shared line, so odd and even heights can differ by one cell in centerY.
  const rows: Array<Array<[string, FlowchartNodeBounds]>> = []
  for (const entry of [...bounds].sort((left, right) => left[1].centerY - right[1].centerY)) {
    const row = rows.at(-1)
    if (row && entry[1].centerY - row[0]![1].centerY <= 1) row.push(entry)
    else rows.push([entry])
  }
  return new Map(
    rows.flatMap((row) => {
      const height = Math.max(...row.map((entry) => entry[1].height))
      return row.flatMap(([id, bound]) => (bound.height < height ? [[id, height - bound.height] as const] : []))
    }),
  )
}

/**
 * Move a class that has a single relationship in line with where that line leaves the other class,
 * so the line runs straight. Skipped when the moved box would touch another box, frame or line.
 */
function straightenLeafRoutes(layout: FlowchartLayout, namespaced: ReadonlySet<string>): void {
  for (const route of layout.routes) {
    const id = route.edge.to
    const box = layout.bounds.get(id)
    const start = route.points[0]
    const end = route.points.at(-1)
    if (!box || !start || !end || route.points.length <= 2 || namespaced.has(id)) continue
    if (layout.routes.some((other) => other !== route && (other.edge.from === id || other.edge.to === id))) continue

    const above = start.y < box.top - 1
    const below = start.y > box.top + box.height
    const leftOf = start.x < box.left - 1
    const rightOf = start.x > box.left + box.width
    const vertical = above || below
    if (!vertical && !leftOf && !rightOf) continue
    const dx = vertical ? start.x - box.centerX : 0
    const dy = vertical ? 0 : start.y - box.centerY
    const moved = { left: box.left + dx, top: box.top + dy, width: box.width, height: box.height }
    // End the straight line on the side of the box that faces the other class.
    const straight = [
      start,
      vertical
        ? point(start.x, above ? box.top - 1 : box.top + box.height)
        : point(leftOf ? box.left - 1 : box.left + box.width, start.y),
    ]
    if (moved.left < 0 || moved.top < 0) continue

    const margin = { left: moved.left - 3, top: moved.top - 1, width: moved.width + 6, height: moved.height + 2 }
    const others = [...layout.bounds].filter(([other]) => other !== id).map(([, bounds]) => bounds)
    const blocked =
      [...others, ...layout.subgraphBounds.values()].some((bounds) => intersects(margin, bounds)) ||
      routeCells(straight).some((cell) => others.some((bounds) => contains(bounds, cell))) ||
      layout.routes
        .filter((other) => other !== route)
        .some((other) => routeCells(other.points).some((cell) => contains(margin, cell)))
    if (blocked) continue

    translateDiagramBounds(box, dx, dy)
    route.points = straight
    delete route.labelPoint
    delete route.labelAxis
    layout.width = Math.max(layout.width, box.left + box.width + 4)
    layout.height = Math.max(layout.height, box.top + box.height + 4)
  }
}

type Rect = { left: number; top: number; width: number; height: number }

function intersects(left: Rect, right: Rect): boolean {
  return (
    left.left < right.left + right.width &&
    right.left < left.left + left.width &&
    left.top < right.top + right.height &&
    right.top < left.top + left.height
  )
}

function contains(rect: Rect, cell: DiagramPoint): boolean {
  return intersects(rect, { left: cell.x, top: cell.y, width: 1, height: 1 })
}

function routeCells(points: readonly DiagramPoint[]): DiagramPoint[] {
  const cells: DiagramPoint[] = []
  for (let index = 1; index < points.length; index++) {
    walkOrthogonalSegment(points[index - 1]!, points[index]!, index === 1, (cell) => {
      cells.push(cell)
    })
  }
  const last = points.at(-1)
  if (last) cells.push(last)
  return cells
}

function relationKey(from: string, to: string, label: string): string {
  return JSON.stringify([from, to, label])
}

function classLines(node: ClassNode, padding = 0): string[] {
  const header = [...node.annotations.map((annotation) => `«${annotation}»`), node.label]
  return [
    ...header,
    ...(node.attributes.length ? [SEPARATOR, ...node.attributes] : []),
    ...(node.methods.length ? [SEPARATOR, ...node.methods] : []),
    ...Array.from({ length: padding }, () => ""),
  ]
}

function drawClass(grid: ClassGrid, node: ClassNode, bounds: FlowchartNodeBounds, padding: number): void {
  const right = bounds.left + bounds.width - 1
  for (let y = bounds.top + 1; y < bounds.top + bounds.height - 1; y++) {
    for (let x = bounds.left + 1; x < right; x++) grid.replaceCell(x, y, " ", "classText")
  }
  drawDiagramFrame(bounds, BORDER, (x, y, char) => grid.replaceCell(x, y, char, "classBorder"))

  const headerLength = node.annotations.length + 1
  for (const [index, line] of classLines(node, padding).entries()) {
    const y = bounds.top + 1 + index
    if (line === SEPARATOR) {
      grid.replaceCell(bounds.left, y, BORDER.leftT, "classBorder")
      grid.replaceCell(right, y, BORDER.rightT, "classBorder")
      for (let x = bounds.left + 1; x < right; x++) grid.replaceCell(x, y, BORDER.horizontal, "classBorder")
      continue
    }
    const header = index < headerLength
    const parsed = parseDiagramTextLines(line)[0]!
    const x = header
      ? bounds.left + Math.max(1, Math.floor((bounds.width - diagramTextWidth(parsed.text)) / 2))
      : bounds.left + 2
    const style = !header ? "classText" : index === headerLength - 1 ? "classTitle" : "annotation"
    let offset = 0
    for (const run of parsed.runs) {
      grid.setText(x + offset, y, run.text, style, run.italic ? { attributes: TextAttributes.ITALIC } : undefined)
      offset += diagramTextWidth(run.text)
    }
  }
}

function drawRelation(grid: ClassGrid, route: FlowchartEdgeRoute, relation: ClassRelation): void {
  const points = route.points
  if (points.length < 2) return
  drawOrthogonalPath(points, (x, y, char) => grid.setCell(x, y, relation.dashed ? dashed(char) : char, "edge"), {
    cornerStyle: "rounded",
  })
  const start = points[0]!
  const end = points.at(-1)!
  drawEnd(grid, start, points[1]!, relation.fromMarker, relation.dashed)
  drawEnd(grid, end, points.at(-2)!, relation.toMarker, relation.dashed)
  if (relation.label) {
    const label = flowchartRouteLabelLayout(route, diagramTextWidth)
    for (const [index, line] of label.lines.entries()) {
      grid.setText(
        label.point.x,
        label.point.y + index,
        " ".repeat(diagramTextWidth(line) + DIAGRAM_LABEL_PADDING_X * 2),
        "label",
      )
      grid.setText(label.point.x + DIAGRAM_LABEL_PADDING_X, label.point.y + index, line, "label")
    }
  }
}

function drawEnd(
  grid: ClassGrid,
  point: DiagramPoint,
  neighbor: DiagramPoint,
  marker: ClassRelationMarker | undefined,
  isDashed: boolean,
): void {
  const direction = directionBetween(neighbor, point)
  if (!direction) return
  const glyph = markerGlyph(marker, direction)
  grid.replaceCell(point.x, point.y, isDashed && !marker ? dashed(glyph) : glyph, "edge")
}

function markerGlyph(marker: ClassRelationMarker | undefined, direction: DiagramDirection): string {
  if (marker === "composition") return "◆"
  if (marker === "aggregation") return "◇"
  if (marker === "arrow") return diagramArrowHead(direction)
  if (marker === "inheritance") return { up: "△", down: "▽", left: "◁", right: "▷" }[direction]
  return diagramLineGlyph(new Set([direction]))
}

function drawCardinality(grid: ClassGrid, point: DiagramPoint, neighbor: DiagramPoint, text: string): boolean {
  const width = diagramTextWidth(text)
  const beside = [
    { x: point.x + 2, y: point.y },
    { x: point.x - width - 1, y: point.y },
  ]
  const around = [
    { x: point.x + 1, y: point.y - 1 },
    { x: point.x - width, y: point.y - 1 },
    { x: point.x + 1, y: point.y + 1 },
    { x: point.x - width, y: point.y + 1 },
  ]
  const candidates = point.x === neighbor.x ? [...beside, ...around] : [...around, ...beside]
  // Keep a blank cell on both sides so the text never touches a box, line or other label.
  const target = candidates.find((candidate) =>
    Array.from({ length: width + 2 }, (_, index) => grid.getCell(candidate.x - 1 + index, candidate.y)).every(
      (cell) => cell?.char === " " && cell.style === undefined,
    ),
  )
  if (!target) return false
  grid.setText(target.x, target.y, text, "label")
  return true
}

const DASHED: Record<string, string> = { "─": "╌", "│": "╎" }
const SOLID: Record<string, string> = { "╌": "─", "╎": "│" }

function dashed(char: string): string {
  return DASHED[char] ?? char
}

function mergeCell(
  existing: DiagramCanvasCell<ClassCellStyle, { attributes?: number }>,
  incoming: DiagramCanvasCell<ClassCellStyle, { attributes?: number }>,
): DiagramCanvasCell<ClassCellStyle, { attributes?: number }> {
  if (incoming.style !== "edge") return incoming
  if (existing.style === "label" || incoming.char === " ") return existing
  if (existing.style !== "edge" || existing.char === " ") return incoming
  if (DIAGRAM_ARROW_HEADS.has(existing.char) || MARKERS.has(existing.char)) return existing
  const merged = mergeDiagramLineGlyph(
    SOLID[existing.char] ?? existing.char,
    SOLID[incoming.char] ?? incoming.char,
    "rounded",
  )
  if (!merged) return incoming
  // Keep the dashed glyph only where both strokes are dashed and continue straight through.
  return { ...incoming, char: existing.char in SOLID && incoming.char in SOLID ? dashed(merged) : merged }
}
