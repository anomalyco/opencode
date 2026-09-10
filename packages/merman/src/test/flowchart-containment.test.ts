import { expect, test } from "bun:test"
import { diagramArrowHeadBetween } from "../core/drawing.js"
import { diagramBoundsFromRect, orthogonalPathPoints } from "../core/geometry.js"
import { drawFlowchartDiagramGrid } from "../flowchart/drawing.js"
import { flowchartRouteLabelLayout } from "../flowchart/labels.js"
import { layoutFlowchartDiagram, visualLength } from "../flowchart/layout.js"
import { parseMermaidFlowchartDiagram } from "../flowchart/parser.js"
import { flowchartSourceConnector, routeFlowchartEdges } from "../flowchart/routing.js"
import type { FlowchartNodeBounds, FlowchartSubgraphBounds } from "../flowchart/types.js"

test.each(
  (["TD", "BT", "LR", "RL"] as const).flatMap((direction) =>
    [false, true].flatMap((reverse) =>
      ["", "one", "one<br/>two"].flatMap((label) =>
        [false, true].map((bidirectional) => ({ direction, reverse, label, bidirectional })),
      ),
    ),
  ),
)("routes contained endpoints $direction reverse=$reverse label=$label bidirectional=$bidirectional", (fixture) => {
  checkContainment(
    `flowchart ${fixture.direction}\nsubgraph G\nA\nend\n${fixture.reverse ? "A" : "G"} ${fixture.bidirectional ? "<-->" : "-->"}${fixture.label ? `|${fixture.label}|` : ""} ${fixture.reverse ? "G" : "A"}`,
  )
})

test.each(
  (["TD", "BT", "LR", "RL"] as const).flatMap((direction) =>
    [false, true].flatMap((reverse) => ["H", "A"].map((member) => ({ direction, reverse, member }))),
  ),
)("routes an ancestor $direction to nested $member reverse=$reverse", (fixture) => {
  checkContainment(
    `flowchart ${fixture.direction}\nsubgraph G\nsubgraph H\nA\nend\nend\n${fixture.reverse ? fixture.member : "G"} <-->|one<br/>two| ${fixture.reverse ? "G" : fixture.member}`,
  )
})

test.each([false, true])("detours around a contained member without leaving the frame reverse=%s", (reverse) => {
  const diagram = parseMermaidFlowchartDiagram(
    `flowchart TD\nsubgraph G\nA\nB\nend\n${reverse ? "A --> G" : "G --> A"}`,
  )
  const frame: FlowchartSubgraphBounds = {
    id: "G",
    label: "G",
    labelSide: reverse ? "top" : "bottom",
    ...diagramBoundsFromRect(0, 0, 24, 20),
  }
  const bounds = new Map<string, FlowchartNodeBounds>([
    ["G", { ...frame, lines: [] }],
    ["A", { id: "A", lines: ["A"], ...diagramBoundsFromRect(9, reverse ? 4 : 10, 5, 3) }],
    ["B", { id: "B", lines: ["B"], ...diagramBoundsFromRect(9, reverse ? 10 : 5, 5, 3) }],
  ])
  const route = routeFlowchartEdges(diagram, bounds, undefined, new Map([["G", frame]]))[0]!
  expect(route.points.length).toBeGreaterThan(2)
  for (const point of orthogonalPathPoints(route.points)) {
    expect(point.x > frame.left && point.x < frame.left + frame.width - 1).toBe(true)
    expect(point.y > frame.top && point.y < frame.top + frame.height - 1).toBe(true)
    for (const id of ["A", "B"]) {
      const node = bounds.get(id)!
      expect(
        point.x >= node.left &&
          point.x < node.left + node.width &&
          point.y >= node.top &&
          point.y < node.top + node.height,
      ).toBe(false)
    }
  }
})

function checkContainment(source: string) {
  const diagram = parseMermaidFlowchartDiagram(source)
  const options = { compact: true }
  const layout = layoutFlowchartDiagram(diagram, options)
  const grid = drawFlowchartDiagramGrid(diagram, options)
  const frame = layout.subgraphBounds.get("G")!
  expect(layout.routes).toHaveLength(1)
  const route = layout.routes[0]!
  const endpoints = new Map([
    ...layout.bounds,
    ...[...layout.subgraphBounds].map(
      ([id, bound]) => [id, { ...bound, lines: [] }] satisfies [string, FlowchartNodeBounds],
    ),
  ])
  const start = route.points[0]!
  const end = route.points.at(-1)!
  const startContact = flowchartSourceConnector(endpoints.get(route.edge.from)!, start)
  const endContact = flowchartSourceConnector(endpoints.get(route.edge.to)!, end)
  expect(Math.abs(start.x - startContact.x) + Math.abs(start.y - startContact.y)).toBe(1)
  expect(Math.abs(end.x - endContact.x) + Math.abs(end.y - endContact.y)).toBe(1)
  expect(grid.getCell(startContact.x, startContact.y)?.char).toBe(startContact.char)
  expect(grid.getCell(end.x, end.y)?.char).toBe(diagramArrowHeadBetween(end, endContact))
  if (route.edge.sourceArrowhead) {
    expect(grid.getCell(start.x, start.y)?.char).toBe(diagramArrowHeadBetween(start, startContact))
  }
  const label = route.edge.label ? flowchartRouteLabelLayout(route, visualLength) : undefined
  for (const point of orthogonalPathPoints(route.points)) {
    expect(point.x > frame.left && point.x < frame.left + frame.width - 1).toBe(true)
    expect(point.y > frame.top && point.y < frame.top + frame.height - 1).toBe(true)
    for (const node of layout.bounds.values()) {
      expect(
        point.x >= node.left &&
          point.x < node.left + node.width &&
          point.y >= node.top &&
          point.y < node.top + node.height,
      ).toBe(false)
    }
    const cell = grid.getCell(point.x, point.y)!
    if (label?.height === 1 && cell.style === "label") continue
    expect(cell.style).not.toBe("label")
    expect(cell.char).not.toBe(" ")
  }
  if (label) for (const line of label.lines) expect(grid.toString()).toContain(line.trim())
}
