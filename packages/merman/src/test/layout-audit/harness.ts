import { orthogonalPathPoints, segmentBetween, type DiagramPoint } from "../../core/geometry.js"
import { SpatialIndex, spatialPathClaim, spatialRectClaim } from "../../core/spatial.js"
import { diagramTextWidth } from "../../core/text.js"
import { splitDiagramLines } from "../../core/text-lines.js"
import { drawFlowchartDiagramGrid } from "../../flowchart/drawing.js"
import { layoutFlowchartDiagram } from "../../flowchart/layout.js"
import { flowchartRouteLabelLayout } from "../../flowchart/labels.js"
import { parseMermaidFlowchartDiagram } from "../../flowchart/parser.js"
import { createStateDiagramDrawing } from "../../state/drawing.js"
import type { StateDiagramBoxBounds } from "../../state/layout.js"
import { stateDiagramNoteConnector } from "../../state/note.js"
import { parseMermaidStateDiagram } from "../../state/parser.js"
import type { StateTransitionRenderPlan } from "../../state/routing.js"
import { isHiddenCompositeMarker } from "../../state/visible-model.js"
import { layoutFixtures, type LayoutFixture } from "./fixtures.js"

export const auditViewports = [60, 80, 120] as const

export type LayoutMetrics = {
  width: number
  height: number
  area: number
  routeLength: number
  bends: number
  crossings: number
  sharedRouteCells: number
  overflow: number
}

export type LayoutAudit = {
  fixture: LayoutFixture
  viewport: (typeof auditViewports)[number]
  output: string
  metrics: LayoutMetrics
  violations: string[]
}

type Bounds = Pick<StateDiagramBoxBounds, "left" | "top" | "width" | "height">
type AuditedRoute = {
  from: string
  to: string
  points: readonly DiagramPoint[]
}

function finiteBounds(bounds: Bounds): boolean {
  return (
    [bounds.left, bounds.top, bounds.width, bounds.height].every(Number.isFinite) &&
    bounds.width > 0 &&
    bounds.height > 0
  )
}

function boundsOverlap(left: Bounds, right: Bounds): boolean {
  return (
    left.left < right.left + right.width &&
    left.left + left.width > right.left &&
    left.top < right.top + right.height &&
    left.top + left.height > right.top
  )
}

function boundsContain(outer: Bounds, inner: Bounds): boolean {
  return (
    inner.left >= outer.left &&
    inner.top >= outer.top &&
    inner.left + inner.width <= outer.left + outer.width &&
    inner.top + inner.height <= outer.top + outer.height
  )
}

function pointInBounds(point: DiagramPoint, bounds: Bounds): boolean {
  return (
    point.x >= bounds.left &&
    point.x < bounds.left + bounds.width &&
    point.y >= bounds.top &&
    point.y < bounds.top + bounds.height
  )
}

function pointTouchesBounds(point: DiagramPoint, bounds: Bounds): boolean {
  if (pointInBounds(point, bounds)) return true
  return (
    ((point.x === bounds.left - 1 || point.x === bounds.left + bounds.width) &&
      point.y >= bounds.top &&
      point.y < bounds.top + bounds.height) ||
    ((point.y === bounds.top - 1 || point.y === bounds.top + bounds.height) &&
      point.x >= bounds.left &&
      point.x < bounds.left + bounds.width)
  )
}

function isOrthogonal(points: readonly DiagramPoint[]): boolean {
  return points.every((point, index) => {
    if (
      !Number.isFinite(point.x) ||
      !Number.isFinite(point.y) ||
      !Number.isInteger(point.x) ||
      !Number.isInteger(point.y)
    )
      return false
    const previous = points[index - 1]
    return !previous || previous.x === point.x || previous.y === point.y
  })
}

function expandedPath(points: readonly DiagramPoint[]): DiagramPoint[] {
  if (!isOrthogonal(points)) return []
  return orthogonalPathPoints(points)
}

function routeLength(points: readonly DiagramPoint[]): number {
  return routeSegments(points).reduce((total, segment) => total + segment.length, 0)
}

function routeBends(points: readonly DiagramPoint[]): number {
  const directions = points.slice(1).flatMap((point, index) => {
    const previous = points[index]
    if (point.x === previous.x && point.y !== previous.y) return ["y"]
    if (point.y === previous.y && point.x !== previous.x) return ["x"]
    return []
  })
  return directions.slice(1).filter((axis, index) => axis !== directions[index]).length
}

function routeSegments(points: readonly DiagramPoint[]) {
  return points.slice(1).flatMap((point, index) => segmentBetween(points[index]!, point) ?? [])
}

function crossingCount(routes: readonly AuditedRoute[]): number {
  let count = 0
  for (const [index, route] of routes.entries()) {
    for (const other of routes.slice(index + 1)) {
      for (const segment of routeSegments(route.points)) {
        for (const otherSegment of routeSegments(other.points)) {
          if (segment.axis === otherSegment.axis) continue
          const horizontal = segment.axis === "x" ? segment : otherSegment
          const vertical = segment.axis === "y" ? segment : otherSegment
          const x = vertical.from.x
          const y = horizontal.from.y
          const horizontalMin = Math.min(horizontal.from.x, horizontal.to.x)
          const horizontalMax = Math.max(horizontal.from.x, horizontal.to.x)
          const verticalMin = Math.min(vertical.from.y, vertical.to.y)
          const verticalMax = Math.max(vertical.from.y, vertical.to.y)
          if (x <= horizontalMin || x >= horizontalMax || y <= verticalMin || y >= verticalMax) continue
          count++
        }
      }
    }
  }
  return count
}

function sharedRouteCellCount(routes: readonly AuditedRoute[]): number {
  let count = 0
  const cells = routes.map((route) => new Set(expandedPath(route.points).map((point) => `${point.x}:${point.y}`)))
  for (const [index, routeCells] of cells.entries()) {
    for (const other of cells.slice(index + 1)) {
      for (const cell of routeCells) if (other.has(cell)) count++
    }
  }
  return count
}

function metrics(
  width: number,
  height: number,
  routes: readonly AuditedRoute[],
  viewport: (typeof auditViewports)[number],
): LayoutMetrics {
  return {
    width,
    height,
    area: width * height,
    routeLength: routes.reduce((total, route) => total + routeLength(route.points), 0),
    bends: routes.reduce((total, route) => total + routeBends(route.points), 0),
    crossings: crossingCount(routes),
    sharedRouteCells: sharedRouteCellCount(routes),
    overflow: Math.max(0, width - viewport),
  }
}

function requireOutputLines(output: string, lines: readonly string[], owner: string, violations: string[]): void {
  for (const line of lines.map((line) => line.trim()).filter(Boolean)) {
    if (!output.includes(line)) violations.push(`${owner} content missing: ${JSON.stringify(line)}`)
  }
}

function validateRoutes(
  routes: readonly AuditedRoute[],
  bounds: ReadonlyMap<string, Bounds>,
  bodyIds: readonly string[],
  violations: string[],
): void {
  for (const [index, route] of routes.entries()) {
    if (route.points.length < 2) {
      violations.push(`route ${index} ${route.from}->${route.to} is empty`)
      continue
    }
    if (!isOrthogonal(route.points))
      violations.push(`route ${index} ${route.from}->${route.to} is not finite and orthogonal`)
    const from = bounds.get(route.from)
    const to = bounds.get(route.to)
    if (!from || !to) {
      violations.push(`route ${index} ${route.from}->${route.to} has a missing endpoint bound`)
      continue
    }
    if (!pointTouchesBounds(route.points[0], from))
      violations.push(`route ${index} does not touch source ${route.from}`)
    if (!pointTouchesBounds(route.points.at(-1)!, to))
      violations.push(`route ${index} does not touch target ${route.to}`)
    if (!isOrthogonal(route.points)) continue
    const bodySpace = SpatialIndex.empty().add(
      ...bodyIds.flatMap((id) => {
        const bound = bounds.get(id)
        return id === route.from || id === route.to || !bound
          ? []
          : [spatialRectClaim(`body:${id}`, `body:${id}`, "body", bound)]
      }),
    )
    const conflicts = bodySpace.conflicts(spatialPathClaim(`route:${index}`, `route:${index}`, "route", route.points))
    for (const id of new Set(conflicts.map((conflict) => conflict.existing.owner.slice("body:".length)))) {
      violations.push(`route ${index} ${route.from}->${route.to} intersects unrelated body ${id}`)
    }
  }
}

function validateBodies(bounds: ReadonlyMap<string, Bounds>, ids: readonly string[], violations: string[]): void {
  let occupied = SpatialIndex.empty()
  for (const id of ids) {
    const bound = bounds.get(id)
    if (!bound) {
      violations.push(`missing body bound ${id}`)
      continue
    }
    if (!finiteBounds(bound)) {
      violations.push(`body ${id} has invalid bounds`)
      continue
    }
    const claim = spatialRectClaim(`body:${id}`, `body:${id}`, "body", bound)
    for (const otherId of new Set(
      occupied.conflicts(claim).map((conflict) => conflict.existing.owner.slice("body:".length)),
    )) {
      violations.push(`bodies ${id} and ${otherId} overlap`)
    }
    occupied = occupied.add(claim)
  }
}

function auditFlowchart(fixture: LayoutFixture, viewport: (typeof auditViewports)[number]): LayoutAudit {
  const violations: string[] = []
  const diagram = parseMermaidFlowchartDiagram(fixture.source)
  const layout = layoutFlowchartDiagram(diagram, { compact: true, layoutMaxWidth: viewport })
  const grid = drawFlowchartDiagramGrid(diagram, { compact: true, layoutMaxWidth: viewport })
  const output = grid.toString({ trimTop: true, trimBottom: true })
  const size = grid.getTextSize({ trimTop: true, trimBottom: true })
  const routes = layout.routes.map((route) => ({ from: route.edge.from, to: route.edge.to, points: route.points }))
  const bodyIds = layout.diagram.nodes.map((node) => node.id)

  if (!Number.isFinite(size.width) || !Number.isFinite(size.height) || size.width <= 0 || size.height <= 0)
    violations.push("rendered grid has invalid dimensions")
  if (!Number.isFinite(layout.width) || !Number.isFinite(layout.height) || layout.width <= 0 || layout.height <= 0)
    violations.push("layout has invalid dimensions")
  if (layout.routes.length !== layout.diagram.edges.filter((edge) => !edge.orderOnly).length)
    violations.push("rendered route count does not match visible edge count")
  validateBodies(layout.bounds, bodyIds, violations)
  validateRoutes(routes, layout.bounds, bodyIds, violations)

  for (const node of layout.diagram.nodes)
    requireOutputLines(output, layout.bounds.get(node.id)?.lines ?? [], `node ${node.id}`, violations)
  for (const route of layout.routes) {
    if (!route.edge.label) continue
    requireOutputLines(
      output,
      flowchartRouteLabelLayout(route, diagramTextWidth).lines,
      `edge ${route.edge.from}->${route.edge.to}`,
      violations,
    )
    const targets = new Set(
      layout.diagram.edges.filter((edge) => edge.label && edge.from === route.edge.from).map((edge) => edge.to),
    )
    const sources = new Set(
      layout.diagram.edges.filter((edge) => edge.label && edge.to === route.edge.to).map((edge) => edge.from),
    )
    const label = flowchartRouteLabelLayout(route, diagramTextWidth)
    if (
      fixture.family === "grouped-fanout" &&
      (targets.size > 1 || sources.size > 1) &&
      label.point.x + label.width > viewport
    ) {
      violations.push(`grouped edge ${route.edge.from}->${route.edge.to} label exceeds viewport`)
    }
  }
  for (const subgraph of layout.diagram.subgraphs ?? []) {
    const bound = layout.subgraphBounds.get(subgraph.id)
    if (!bound || !finiteBounds(bound)) violations.push(`subgraph ${subgraph.id} has invalid bounds`)
    requireOutputLines(output, splitDiagramLines(subgraph.label), `subgraph ${subgraph.id}`, violations)
    for (const nodeId of subgraph.nodeIds) {
      const node = layout.bounds.get(nodeId)
      if (bound && node && !boundsContain(bound, node))
        violations.push(`subgraph ${subgraph.id} does not contain ${nodeId}`)
    }
  }
  const subgraphs = layout.diagram.subgraphs ?? []
  const subgraphById = new Map(subgraphs.map((subgraph) => [subgraph.id, subgraph]))
  const ancestorOf = (ancestor: string, id: string) => {
    let parentId = subgraphById.get(id)?.parentId
    while (parentId) {
      if (parentId === ancestor) return true
      parentId = subgraphById.get(parentId)?.parentId
    }
    return false
  }
  for (const [index, subgraph] of subgraphs.entries()) {
    const bound = layout.subgraphBounds.get(subgraph.id)
    if (!bound) continue
    for (const other of subgraphs.slice(index + 1)) {
      if (ancestorOf(subgraph.id, other.id) || ancestorOf(other.id, subgraph.id)) continue
      const otherBound = layout.subgraphBounds.get(other.id)
      if (otherBound && boundsOverlap(bound, otherBound)) {
        violations.push(`subgraphs ${subgraph.id} and ${other.id} overlap`)
      }
    }
  }

  return { fixture, viewport, output, metrics: metrics(size.width, size.height, routes, viewport), violations }
}

function stateRoute(route: StateTransitionRenderPlan): AuditedRoute {
  return {
    from: route.route.transition.from,
    to: route.route.transition.to,
    points: route.path.map(([x, y]) => ({ x, y })),
  }
}

function auditState(fixture: LayoutFixture, viewport: (typeof auditViewports)[number]): LayoutAudit {
  const violations: string[] = []
  const parsed = parseMermaidStateDiagram(fixture.source)
  const drawing = createStateDiagramDrawing(parsed, { minStateGap: 5, layoutMaxWidth: viewport })
  const diagram = drawing.diagram
  const layout = drawing.layout
  const plans = drawing.transitionPlans
  const grid = drawing.grid
  const routes = plans.map(stateRoute)
  const output = grid.toString({ trimTop: true, trimBottom: true })
  const size = grid.getTextSize({ trimTop: true, trimBottom: true })
  const bodyIds = diagram.states.filter((state) => !isHiddenCompositeMarker(state)).map((state) => state.id)

  if (!Number.isFinite(size.width) || !Number.isFinite(size.height) || size.width <= 0 || size.height <= 0)
    violations.push("rendered grid has invalid dimensions")
  if (plans.length !== diagram.transitions.length)
    violations.push("rendered route count does not match visible transition count")
  validateBodies(layout.bounds, bodyIds, violations)
  validateRoutes(routes, layout.bounds, bodyIds, violations)
  if (diagram.direction === "BT" && fixture.family === "chain") {
    for (const transition of diagram.transitions) {
      if (transition.from === transition.to) continue
      const from = layout.bounds.get(transition.from)
      const to = layout.bounds.get(transition.to)
      if (from && to && from.centerY <= to.centerY) {
        violations.push(`BT transition ${transition.from}->${transition.to} does not travel upward`)
      }
    }
  }

  for (const state of diagram.states) {
    if (isHiddenCompositeMarker(state)) continue
    requireOutputLines(output, layout.sizes.get(state.id)?.lines ?? [state.label], `state ${state.id}`, violations)
  }
  for (const plan of plans) {
    if (!plan.route.transition.label) continue
    if (!plan.label)
      violations.push(`transition ${plan.route.transition.from}->${plan.route.transition.to} has no label layout`)
    requireOutputLines(
      output,
      plan.label?.lines ?? [],
      `transition ${plan.route.transition.from}->${plan.route.transition.to}`,
      violations,
    )
  }

  const statesById = new Map(diagram.states.map((state) => [state.id, state]))
  const compositesById = new Map(diagram.composites.map((composite) => [composite.id, composite]))
  const descendantOf = (id: string, compositeId: string) => {
    let parentId = statesById.get(id)?.parentId ?? compositesById.get(id)?.parentId
    while (parentId) {
      if (parentId === compositeId) return true
      parentId = compositesById.get(parentId)?.parentId
    }
    return false
  }
  for (const composite of diagram.composites) {
    const bound = layout.compositeBounds.get(composite.id)
    if (!bound || !finiteBounds(bound)) {
      violations.push(`composite ${composite.id} has invalid bounds`)
      continue
    }
    requireOutputLines(output, splitDiagramLines(composite.label), `composite ${composite.id}`, violations)
    for (const state of diagram.states.filter(
      (state) => !isHiddenCompositeMarker(state) && descendantOf(state.id, composite.id),
    )) {
      const stateBound = layout.bounds.get(state.id)
      if (stateBound && !boundsContain(bound, stateBound))
        violations.push(`composite ${composite.id} does not contain ${state.id}`)
    }
  }

  for (const [index, note] of layout.noteBounds.entries()) {
    if (!finiteBounds(note)) violations.push(`note ${index} has invalid bounds`)
    requireOutputLines(output, note.lines, `note ${index}`, violations)
    for (const id of bodyIds) {
      const bound = layout.bounds.get(id)
      if (bound && boundsOverlap(note, bound)) violations.push(`note ${index} overlaps state ${id}`)
    }
    for (const other of layout.noteBounds.slice(index + 1)) {
      if (boundsOverlap(note, other)) violations.push(`notes ${index} and ${other.id} overlap`)
    }
    const target = layout.bounds.get(note.note.target)
    if (!target) {
      violations.push(`note ${index} has no target bound`)
      continue
    }
    for (const point of expandedPath(stateDiagramNoteConnector(note, target).points)) {
      for (const id of bodyIds) {
        if (id === note.note.target) continue
        const bound = layout.bounds.get(id)
        if (bound && pointInBounds(point, bound)) violations.push(`note ${index} connector intersects state ${id}`)
      }
      for (const other of layout.noteBounds) {
        if (other === note) continue
        if (pointInBounds(point, other)) violations.push(`note ${index} connector intersects note ${other.id}`)
      }
    }
  }

  return { fixture, viewport, output, metrics: metrics(size.width, size.height, routes, viewport), violations }
}

export function auditFixture(fixture: LayoutFixture, viewport: (typeof auditViewports)[number] = 120): LayoutAudit {
  return fixture.kind === "flowchart" ? auditFlowchart(fixture, viewport) : auditState(fixture, viewport)
}

export function auditAllFixtures(): LayoutAudit[] {
  return layoutFixtures().flatMap((fixture, index) => {
    if (fixture.curated) return auditViewports.map((viewport) => auditFixture(fixture, viewport))
    if (fixture.kind === "flowchart") {
      return auditFixture(fixture, auditViewports[index % auditViewports.length])
    }
    const viewport = fixture.profile === "short" ? 60 : fixture.profile === "unicode" ? 80 : 120
    return auditFixture(fixture, viewport)
  })
}

function percentile(values: readonly number[], ratio: number): number {
  if (values.length === 0) return 0
  return [...values].sort((left, right) => left - right)[Math.ceil(values.length * ratio) - 1] ?? 0
}

export function summarizeAudits(audits: readonly LayoutAudit[]) {
  const summarize = (selected: readonly LayoutAudit[]) => ({
    runs: selected.length,
    sources: new Set(selected.map((audit) => audit.fixture.id)).size,
    violations: selected.reduce((total, audit) => total + audit.violations.length, 0),
    area: {
      p50: percentile(
        selected.map((audit) => audit.metrics.area),
        0.5,
      ),
      p95: percentile(
        selected.map((audit) => audit.metrics.area),
        0.95,
      ),
      max: Math.max(0, ...selected.map((audit) => audit.metrics.area)),
    },
    bends: {
      p95: percentile(
        selected.map((audit) => audit.metrics.bends),
        0.95,
      ),
      max: Math.max(0, ...selected.map((audit) => audit.metrics.bends)),
    },
    crossings: {
      total: selected.reduce((total, audit) => total + audit.metrics.crossings, 0),
      max: Math.max(0, ...selected.map((audit) => audit.metrics.crossings)),
    },
    routeLength: {
      p95: percentile(
        selected.map((audit) => audit.metrics.routeLength),
        0.95,
      ),
      max: Math.max(0, ...selected.map((audit) => audit.metrics.routeLength)),
    },
    sharedRouteCells: {
      p95: percentile(
        selected.map((audit) => audit.metrics.sharedRouteCells),
        0.95,
      ),
      max: Math.max(0, ...selected.map((audit) => audit.metrics.sharedRouteCells)),
    },
    overflow: {
      p95: percentile(
        selected.map((audit) => audit.metrics.overflow),
        0.95,
      ),
      max: Math.max(0, ...selected.map((audit) => audit.metrics.overflow)),
    },
  })
  return {
    total: summarize(audits),
    flowchart: summarize(audits.filter((audit) => audit.fixture.kind === "flowchart")),
    state: summarize(audits.filter((audit) => audit.fixture.kind === "state")),
  }
}

export function worstAudits(audits: readonly LayoutAudit[], metric: keyof LayoutMetrics, limit = 10): LayoutAudit[] {
  return [...audits]
    .sort(
      (left, right) => right.metrics[metric] - left.metrics[metric] || left.fixture.id.localeCompare(right.fixture.id),
    )
    .slice(0, limit)
}
