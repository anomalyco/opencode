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
import { diagramTextWidth, DIAGRAM_LABEL_PADDING_X } from "../core/text.js"
import { flowchartRouteLabelLayout } from "../flowchart/labels.js"
import { layoutFlowchartDiagram, type FlowchartLayout } from "../flowchart/layout.js"
import { flowchartSourceConnector } from "../flowchart/routing.js"
import type { FlowchartDiagram, FlowchartEdge, FlowchartEdgeRoute, FlowchartNodeBounds } from "../flowchart/types.js"
import type {
  ClassCellStyle,
  ClassDiagram,
  ClassDiagramRenderOptions,
  ClassMember,
  ClassNode,
  ClassRelation,
  ClassRelationMarker,
} from "./types.js"

export type ClassGrid = DiagramCanvas<ClassCellStyle, { attributes?: number }>

type ClassRow =
  | { kind: "separator" }
  | { kind: "text"; text: string; style: ClassCellStyle; centered: boolean; attributes?: number }

type RelationEntry = { route: FlowchartEdgeRoute; relation: ClassRelation }

const BORDER = BorderChars.rounded
const MARKERS = new Set(["△", "▽", "◁", "▷", "◆", "◇"])
// Layout pads labels of sideways lines with this non-whitespace blank to reserve room for cardinalities.
const RESERVE = "\u2800"

export function drawClassDiagramGrid(diagram: ClassDiagram, options: ClassDiagramRenderOptions = {}): ClassGrid {
  const layoutOptions = { compact: options.compact, layoutMaxWidth: options.layoutMaxWidth, separateLooseNodes: true }
  const unpadded = toFlowchart(diagram, new Map())
  const firstLayout = layoutFlowchartDiagram(unpadded.flowchart, layoutOptions)
  const padding = rowPadding(firstLayout.bounds)
  const padded = padding.size ? toFlowchart(diagram, padding) : unpadded
  const layout = padding.size ? layoutFlowchartDiagram(padded.flowchart, layoutOptions) : firstLayout
  const relations = padded.relations
  straightenLeafRoutes(layout, new Set(diagram.namespaces.flatMap((namespace) => namespace.classIds)))
  const entries = layout.routes.flatMap((route) => {
    const relation = relations.get(route.edge)
    return relation ? [{ route, relation }] : []
  })
  separateTerminals(layout, entries)
  const first = drawLayout(diagram, layout, entries, padding)
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
  return drawLayout(diagram, layout, entries, padding).grid
}

function toFlowchart(
  diagram: ClassDiagram,
  padding: ReadonlyMap<string, number>,
): { flowchart: FlowchartDiagram; relations: Map<FlowchartEdge, ClassRelation> } {
  const sideways = diagram.direction === "LR" || diagram.direction === "RL"
  const relations = new Map<FlowchartEdge, ClassRelation>()
  const edges = diagram.relations.map((relation) => {
    const reserve = sideways
      ? RESERVE.repeat(
          Math.max(diagramTextWidth(relation.fromCardinality ?? ""), diagramTextWidth(relation.toCardinality ?? "")) +
            (relation.fromCardinality || relation.toCardinality ? 2 : 0),
        )
      : ""
    const edge: FlowchartEdge = { from: relation.from, to: relation.to, label: `${reserve}${relation.label}${reserve}` }
    relations.set(edge, relation)
    return edge
  })
  return {
    flowchart: {
      direction: diagram.direction,
      nodes: diagram.classes.map((node) => ({
        id: node.id,
        // Layout only measures the label, so angle brackets from generics must not be read as markup.
        // The first row is padded so the box is wide enough for separate line terminals.
        label: classRows(node, padding.get(node.id) ?? 0)
          .map((row) => (row.kind === "separator" ? "" : row.text.replaceAll("<", "‹").replaceAll(">", "›")))
          .map((line, index) => (index === 0 ? line.padEnd(terminalWidth(diagram, node.id), RESERVE) : line))
          .join("<br>"),
        shape: "box",
      })),
      edges,
      subgraphs: diagram.namespaces.map((namespace) => ({
        id: namespace.id,
        label: namespace.id,
        nodeIds: namespace.classIds,
      })),
    },
    relations,
  }
}

/**
 * Width a class needs so lines with different markers or cardinalities can each meet it at their own cell,
 * two cells apart (see separateTerminals).
 */
function terminalWidth(diagram: ClassDiagram, id: string): number {
  const signatures = new Set(
    diagram.relations.flatMap((relation) => [
      ...(relation.from === id ? [`${relation.fromMarker ?? ""}|${relation.fromCardinality ?? ""}`] : []),
      ...(relation.to === id ? [`${relation.toMarker ?? ""}|${relation.toCardinality ?? ""}`] : []),
    ]),
  )
  return signatures.size < 2 ? 0 : 4 * Math.ceil((signatures.size - 1) / 2) - 1
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
  entries: readonly RelationEntry[],
  padding: ReadonlyMap<string, number>,
): { grid: ClassGrid; dropped: boolean } {
  const grid: ClassGrid = new DiagramCanvas(layout.width, layout.height, { mergeCell })

  for (const bounds of layout.subgraphBounds.values()) {
    drawDiagramFrame(bounds, BORDER, (x, y, char) => grid.setCell(x, y, char, "namespace"))
  }
  for (const entry of entries) drawRelationLine(grid, entry.route, entry.relation)
  for (const entry of entries) drawRelationEnds(grid, entry, layout)
  for (const entry of entries) drawRelationLabel(grid, entry.route)
  for (const node of diagram.classes) {
    const bounds = layout.bounds.get(node.id)
    if (bounds) drawClass(grid, node, bounds, padding.get(node.id) ?? 0)
  }
  // Unmarked ends join the box border, as markers already sit against it.
  for (const { route, relation } of entries) {
    const ends = [
      { bounds: layout.bounds.get(route.edge.from), point: route.points[0], marker: relation.fromMarker },
      { bounds: layout.bounds.get(route.edge.to), point: route.points.at(-1), marker: relation.toMarker },
    ]
    for (const end of ends) {
      if (!end.bounds || !end.point || end.marker) continue
      const connector = flowchartSourceConnector(end.bounds, end.point)
      const existing = grid.getCell(connector.x, connector.y)?.char ?? connector.char
      const merged = mergeDiagramLineGlyph(existing, connector.char, "rounded") ?? connector.char
      grid.replaceCell(connector.x, connector.y, merged, "classBorder")
    }
  }
  let dropped = false
  // Lines that share an end point show a shared cardinality once.
  const placed = new Set<string>()
  for (const { route, relation } of entries) {
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
    const y = bounds.labelSide === "bottom" ? bounds.top + bounds.height - 1 : bounds.top
    grid.setText(bounds.left + 2, y, ` ${bounds.label} `, "namespaceLabel")
  }
  return { grid, dropped }
}

/** Boxes sharing a layout row get equal heights so their tops and bottoms line up. */
function rowPadding(bounds: ReadonlyMap<string, FlowchartNodeBounds>): Map<string, number> {
  // Rows are centered on a shared line, so odd and even heights can differ by one cell in centerY.
  const rows: Array<Array<[string, FlowchartNodeBounds]>> = []
  for (const entry of [...bounds].sort((left, right) => left[1].centerY - right[1].centerY)) {
    const row = rows.at(-1)
    if (!row || entry[1].centerY - row[0]![1].centerY > 1) {
      rows.push([entry])
      continue
    }
    row.push(entry)
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
 * so the line runs straight. Skipped when the moved box or its label would touch another box, frame or line.
 */
function straightenLeafRoutes(layout: FlowchartLayout, namespaced: ReadonlySet<string>): void {
  for (const route of layout.routes) {
    const id = route.edge.to
    const box = layout.bounds.get(id)
    const start = route.points[0]
    const next = route.points[1]
    if (!box || !start || !next || route.points.length <= 2 || namespaced.has(id)) continue
    if (layout.routes.some((other) => other !== route && (other.edge.from === id || other.edge.to === id))) continue

    // Keep the side the line leaves the other class from: a line leaving a side stays horizontal.
    const leaving = directionBetween(start, next)
    const vertical = leaving === "up" || leaving === "down"
    const above = start.y < box.top - 1
    const below = start.y > box.top + box.height
    const leftOf = start.x < box.left - 1
    const rightOf = start.x > box.left + box.width
    if (vertical ? !above && !below : !leftOf && !rightOf) continue
    const dx = vertical ? start.x - box.centerX : 0
    const dy = vertical ? 0 : start.y - box.centerY
    const moved = { left: box.left + dx, top: box.top + dy, width: box.width, height: box.height }
    const straight = [
      start,
      vertical
        ? point(start.x, above ? box.top - 1 : box.top + box.height)
        : point(leftOf ? box.left - 1 : box.left + box.width, start.y),
    ]
    const label = route.edge.label.replaceAll(RESERVE, "").trim()
      ? flowchartRouteLabelLayout({ edge: route.edge, points: straight }, diagramTextWidth)
      : undefined
    const labelRect = label
      ? { left: label.point.x, top: label.point.y, width: label.width, height: label.height }
      : undefined
    if (moved.left < 0 || moved.top < 0 || (labelRect && (labelRect.left < 0 || labelRect.top < 0))) continue

    const margin = { left: moved.left - 3, top: moved.top - 1, width: moved.width + 6, height: moved.height + 2 }
    const others = [...layout.bounds].filter(([other]) => other !== id).map(([, bounds]) => bounds)
    const blocked =
      [...others, ...layout.subgraphBounds.values()].some((bounds) => intersects(margin, bounds)) ||
      (labelRect !== undefined &&
        [...others, moved, ...layout.subgraphBounds.values()].some((bounds) => intersects(labelRect, bounds))) ||
      routeCells(straight).some((cell) => others.some((bounds) => contains(bounds, cell))) ||
      layout.routes
        .filter((other) => other !== route)
        .some((other) =>
          routeCells(other.points).some(
            (cell) => contains(margin, cell) || (labelRect !== undefined && contains(labelRect, cell)),
          ),
        )
    if (blocked) continue

    translateDiagramBounds(box, dx, dy)
    route.points = straight
    delete route.labelPoint
    delete route.labelAxis
    const extents = [box, ...(labelRect ? [labelRect] : [])]
    layout.width = Math.max(layout.width, ...extents.map((rect) => rect.left + rect.width + 4))
    layout.height = Math.max(layout.height, ...extents.map((rect) => rect.top + rect.height + 4))
  }
}

/**
 * Lines that meet a box at the same cell share one marker. When their markers or cardinalities differ,
 * move the later ones to their own cell along the same side so each keeps its meaning.
 */
function separateTerminals(layout: FlowchartLayout, entries: readonly RelationEntry[]): void {
  const terminals = new Map<string, Array<{ entry: RelationEntry; atStart: boolean; signature: string }>>()
  for (const entry of entries) {
    const ends = [
      {
        atStart: true,
        id: entry.route.edge.from,
        marker: entry.relation.fromMarker,
        cardinality: entry.relation.fromCardinality,
      },
      {
        atStart: false,
        id: entry.route.edge.to,
        marker: entry.relation.toMarker,
        cardinality: entry.relation.toCardinality,
      },
    ]
    for (const end of ends) {
      const terminal = end.atStart ? entry.route.points[0] : entry.route.points.at(-1)
      if (!terminal) continue
      const key = `${end.id}:${terminal.x}:${terminal.y}`
      terminals.set(key, [
        ...(terminals.get(key) ?? []),
        { entry, atStart: end.atStart, signature: `${end.marker ?? ""}|${end.cardinality ?? ""}` },
      ])
    }
  }
  for (const [key, ends] of terminals) {
    const signatures = [...new Set(ends.map((end) => end.signature))]
    if (signatures.length < 2) continue
    const box = layout.bounds.get(key.slice(0, key.indexOf(":")))
    if (!box) continue
    const taken = new Set<number>([0])
    for (const signature of signatures.slice(1)) {
      const sample = ends.find((end) => end.signature === signature)!
      const terminal = sample.atStart ? sample.entry.route.points[0]! : sample.entry.route.points.at(-1)!
      const alongX = terminal.y < box.top || terminal.y >= box.top + box.height
      const coordinate = alongX ? terminal.x : terminal.y
      const [low, high] = alongX ? [box.left + 1, box.left + box.width - 2] : [box.top + 1, box.top + box.height - 2]
      const offset = [2, -2, 4, -4, 6, -6].find(
        (candidate) => !taken.has(candidate) && coordinate + candidate >= low && coordinate + candidate <= high,
      )
      if (offset === undefined) continue
      taken.add(offset)
      for (const end of ends.filter((candidate) => candidate.signature === signature)) {
        const points = end.atStart ? [...end.entry.route.points].reverse() : end.entry.route.points
        const shifted = shiftTerminal(points, offset, alongX)
        end.entry.route.points = end.atStart ? shifted.reverse() : shifted
      }
    }
  }
}

/** Move the last point of a path sideways along the box, with a short jog one cell before the box. */
function shiftTerminal(points: readonly DiagramPoint[], offset: number, alongX: boolean): DiagramPoint[] {
  const end = points.at(-1)!
  const previous = points.at(-2)!
  const outward = alongX ? Math.sign(previous.y - end.y) : Math.sign(previous.x - end.x)
  const approach = alongX ? point(end.x, end.y + outward) : point(end.x + outward, end.y)
  const jog = alongX ? point(approach.x + offset, approach.y) : point(approach.x, approach.y + offset)
  const shifted = alongX ? point(end.x + offset, end.y) : point(end.x, end.y + offset)
  return simplifyPath([...points.slice(0, -1), approach, jog, shifted])
}

function simplifyPath(points: readonly DiagramPoint[]): DiagramPoint[] {
  const unique = points.filter(
    (current, index) => index === 0 || current.x !== points[index - 1]!.x || current.y !== points[index - 1]!.y,
  )
  return unique.filter((current, index) => {
    const before = unique[index - 1]
    const after = unique[index + 1]
    if (!before || !after) return true
    return !((before.x === current.x && current.x === after.x) || (before.y === current.y && current.y === after.y))
  })
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

function classRows(node: ClassNode, padding = 0): ClassRow[] {
  const lines = (value: string) => value.split(/<br\s*\/?>/i).map((line) => line.trim())
  const member = (value: ClassMember): ClassRow[] =>
    lines(value.text).map((text) => ({
      kind: "text",
      text,
      style: "classText",
      centered: false,
      ...(value.classifier === "abstract" ? { attributes: TextAttributes.ITALIC } : {}),
      ...(value.classifier === "static" ? { attributes: TextAttributes.UNDERLINE } : {}),
    }))
  return [
    ...node.annotations.map(
      (annotation): ClassRow => ({
        kind: "text",
        text: `«${annotation}»`,
        style: "annotation",
        centered: true,
      }),
    ),
    ...lines(node.label).map((text): ClassRow => ({ kind: "text", text, style: "classTitle", centered: true })),
    ...(node.attributes.length ? [{ kind: "separator" } as const, ...node.attributes.flatMap(member)] : []),
    ...(node.methods.length ? [{ kind: "separator" } as const, ...node.methods.flatMap(member)] : []),
    ...Array.from(
      { length: padding },
      (): ClassRow => ({ kind: "text", text: "", style: "classText", centered: false }),
    ),
  ]
}

function drawClass(grid: ClassGrid, node: ClassNode, bounds: FlowchartNodeBounds, padding: number): void {
  const right = bounds.left + bounds.width - 1
  for (let y = bounds.top + 1; y < bounds.top + bounds.height - 1; y++) {
    for (let x = bounds.left + 1; x < right; x++) grid.replaceCell(x, y, " ", "classText")
  }
  drawDiagramFrame(bounds, BORDER, (x, y, char) => grid.replaceCell(x, y, char, "classBorder"))

  for (const [index, row] of classRows(node, padding).entries()) {
    const y = bounds.top + 1 + index
    if (row.kind === "separator") {
      grid.replaceCell(bounds.left, y, BORDER.leftT, "classBorder")
      grid.replaceCell(right, y, BORDER.rightT, "classBorder")
      for (let x = bounds.left + 1; x < right; x++) grid.replaceCell(x, y, BORDER.horizontal, "classBorder")
      continue
    }
    const x = row.centered
      ? bounds.left + Math.max(1, Math.floor((bounds.width - diagramTextWidth(row.text)) / 2))
      : bounds.left + 2
    grid.setText(x, y, row.text, row.style, row.attributes === undefined ? undefined : { attributes: row.attributes })
  }
}

function drawRelationLine(grid: ClassGrid, route: FlowchartEdgeRoute, relation: ClassRelation): void {
  if (route.points.length < 2) return
  drawOrthogonalPath(route.points, (x, y, char) => grid.setCell(x, y, relation.dashed ? dashed(char) : char, "edge"), {
    cornerStyle: "rounded",
  })
}

function drawRelationEnds(grid: ClassGrid, entry: RelationEntry, layout: FlowchartLayout): void {
  const points = entry.route.points
  if (points.length < 2) return
  const ends = [
    {
      point: points[0]!,
      neighbor: points[1]!,
      marker: entry.relation.fromMarker,
      box: layout.bounds.get(entry.route.edge.from),
    },
    {
      point: points.at(-1)!,
      neighbor: points.at(-2)!,
      marker: entry.relation.toMarker,
      box: layout.bounds.get(entry.route.edge.to),
    },
  ]
  for (const end of ends) {
    // Markers point at the box they touch, whatever direction the line arrives from.
    const direction = end.box ? towardBox(end.point, end.box) : directionBetween(end.neighbor, end.point)
    if (!direction) continue
    if (end.marker) {
      grid.replaceCell(end.point.x, end.point.y, markerGlyph(end.marker, direction), "edge")
      continue
    }
    const glyph = diagramLineGlyph(new Set([direction]))
    grid.setCell(end.point.x, end.point.y, entry.relation.dashed ? dashed(glyph) : glyph, "edge")
  }
}

function drawRelationLabel(grid: ClassGrid, route: FlowchartEdgeRoute): void {
  if (!route.edge.label.replaceAll(RESERVE, "").trim() || route.points.length < 2) return
  const label = flowchartRouteLabelLayout(route, diagramTextWidth)
  for (const [index, line] of label.lines.entries()) {
    const reserved = line.length - line.replace(new RegExp(`^${RESERVE}+`), "").length
    const text = line.replaceAll(RESERVE, "")
    const x = label.point.x + reserved
    grid.setText(x, label.point.y + index, " ".repeat(diagramTextWidth(text) + DIAGRAM_LABEL_PADDING_X * 2), "label")
    grid.setText(x + DIAGRAM_LABEL_PADDING_X, label.point.y + index, text, "label")
  }
}

function towardBox(cell: DiagramPoint, box: FlowchartNodeBounds): DiagramDirection | undefined {
  if (cell.y < box.top) return "down"
  if (cell.y >= box.top + box.height) return "up"
  if (cell.x < box.left) return "right"
  if (cell.x >= box.left + box.width) return "left"
  return undefined
}

function markerGlyph(marker: ClassRelationMarker, direction: DiagramDirection): string {
  if (marker === "composition") return "◆"
  if (marker === "aggregation") return "◇"
  if (marker === "arrow") return diagramArrowHead(direction)
  return { up: "△", down: "▽", left: "◁", right: "▷" }[direction]
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
