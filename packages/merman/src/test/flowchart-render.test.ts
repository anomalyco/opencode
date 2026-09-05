import { expect, test } from "bun:test"
import { diagramArrowHeadBetween } from "../core/drawing.js"
import { orthogonalPathPoints } from "../core/geometry.js"
import { drawFlowchartDiagramGrid } from "../flowchart/drawing.js"
import { flowchartRouteLabelLayout } from "../flowchart/labels.js"
import { layoutFlowchartDiagram, visualLength } from "../flowchart/layout.js"
import { parseMermaidFlowchartDiagram } from "../flowchart/parser.js"
import { renderFlowchartDiagram } from "../flowchart/render.js"
import { flowchartSourceConnector } from "../flowchart/routing.js"
import { expectDiagram } from "./diagram.js"

const architecture = `flowchart TD
    subgraph core["packages/core — one undifferentiated blob"]
        K["kernel<br/>sessions · runner · events<br/>capabilities · claims"]
        D["discovery<br/>config files · project markers<br/>plugins · MCP · auto-recovery"]
        K <-->|"nothing prevents<br/>either direction"| D
    end
    schema --> core
    protocol --> core
    core --> server
    server --> cli["cli / tui"]
    sdk -.->|"composes client+core+server"| server`

test.each(
  (["TD", "BT", "LR", "RL"] as const).flatMap((direction) => [true, false].map((before) => ({ direction, before }))),
)("connects $direction edges to a subgraph boundary with forward references=$before", ({ direction, before }) => {
  const group = "subgraph core[Core]\nK[Kernel] --> D[Discovery]\nend"
  const edges = "schema --> core\ncore --> server"
  const source = `flowchart ${direction}\n${before ? `${edges}\n${group}` : `${group}\n${edges}`}`
  const diagram = parseMermaidFlowchartDiagram(source)
  const layout = layoutFlowchartDiagram(diagram, { compact: true })
  const grid = drawFlowchartDiagramGrid(diagram, { compact: true })
  const frame = layout.subgraphBounds.get("core")!

  expect(diagram.nodes.map((node) => node.id).sort()).toEqual(["D", "K", "schema", "server"])
  expect(layout.bounds.has("core")).toBe(false)
  expect(layout.routes).toHaveLength(3)
  for (const route of layout.routes.filter((route) => route.edge.from === "core" || route.edge.to === "core")) {
    const endpoint = route.edge.from === "core" ? route.points[0]! : route.points.at(-1)!
    const contact = flowchartSourceConnector({ ...frame, lines: [] }, endpoint)
    expect(Math.abs(contact.x - endpoint.x) + Math.abs(contact.y - endpoint.y)).toBe(1)
    expect(contact.x >= frame.left && contact.x < frame.left + frame.width).toBe(true)
    expect(contact.y >= frame.top && contact.y < frame.top + frame.height).toBe(true)
    expect(grid.getCell(contact.x, contact.y)?.style).toBe(route.edge.from === "core" ? "edge" : "group")
    for (const point of orthogonalPathPoints(route.points)) {
      expect(
        point.x > frame.left &&
          point.x < frame.left + frame.width - 1 &&
          point.y > frame.top &&
          point.y < frame.top + frame.height - 1,
      ).toBe(false)
    }
    const end = route.points.at(-1)!
    expect(grid.getCell(end.x, end.y)?.char).toBe(diagramArrowHeadBetween(route.points.at(-2)!, end))
  }
  if (direction === "TD" && !before) {
    expectDiagram(grid.toString({ trimTop: true, trimBottom: true })).toEqualDiagram(`
         ╭────────╮
         │ schema │
         ╰────┬───╯
              │
              ▼
      ╭─ Core ────────╮
      │  ╭────────╮   │
      │  │ Kernel │   │
      │  ╰────┬───╯   │
      │       │       │
      │       ▼       │
      │ ╭───────────╮ │
      │ │ Discovery │ │
      │ ╰───────────╯ │
      ╰───────┬───────╯
              │
              ▼
         ╭────────╮
         │ server │
         ╰────────╯
    `)
  }
})

test.each(["nothing prevents either direction", "nothing prevents<br/>either direction"])(
  "keeps a bidirectional label clear of its own bends and terminals: %s",
  (label) => {
    const source = `flowchart BT
subgraph arch[Architecture]
  K["kernel<br/>sessions · runner · events<br/>capabilities · claims"]
  D["discovery<br/>config files · project markers<br/>plugins · MCP · auto-recovery"]
  K <-->|"${label}"| D
  K --> X
end`
    const diagram = parseMermaidFlowchartDiagram(source)
    const options = { compact: true, layoutMaxWidth: 60 }
    const layout = layoutFlowchartDiagram(diagram, options)
    const grid = drawFlowchartDiagramGrid(diagram, options)
    const route = layout.routes.find((route) => route.edge.to === "D")!
    const start = route.points[0]!
    const end = route.points.at(-1)!
    const connector = flowchartSourceConnector(layout.bounds.get("K")!, start)

    expect(grid.getCell(start.x, start.y)?.char).toBe(diagramArrowHeadBetween(start, connector))
    expect(grid.getCell(end.x, end.y)?.char).toBe(diagramArrowHeadBetween(route.points.at(-2)!, end))
    const placed = flowchartRouteLabelLayout(route, visualLength)
    for (const point of orthogonalPathPoints(route.points)) {
      const cell = grid.getCell(point.x, point.y)!
      if (placed.height === 1 && cell.style === "label") continue
      expect(cell.style).not.toBe("label")
      expect(cell.char).not.toBe(" ")
    }
    for (const line of placed.lines) expect(grid.toString()).toContain(line.trim())
    if (placed.height === 2) {
      expectDiagram(grid.toString({ trimTop: true, trimBottom: true })).toEqualDiagram(`
        ╭─ Architecture ────────────────────────────────╮
        │  ╭────────────────────────────────╮           │
        │  │           discovery            │     ╭───╮ │
        │  │ config files · project markers │     │ X │ │
        │  │ plugins · MCP · auto-recovery  │     ╰───╯ │
        │  ╰────────────────────────────────╯       ▲   │
        │                   ▲                       │   │
        │  nothing prevents │                       │   │
        │  either direction ╰────┬──────────────────╯   │
        │                        ▼                      │
        │         ╭──────────────┴─────────────╮        │
        │         │           kernel           │        │
        │         │ sessions · runner · events │        │
        │         │   capabilities · claims    │        │
        │         ╰────────────────────────────╯        │
        ╰───────────────────────────────────────────────╯
      `)
    }
  },
)

test.each([60, 120])("renders the architecture repro without phantom nodes or severed paths at width %s", (width) => {
  const diagram = parseMermaidFlowchartDiagram(architecture)
  const options = { compact: true, layoutMaxWidth: width }
  const layout = layoutFlowchartDiagram(diagram, options)
  const grid = drawFlowchartDiagramGrid(diagram, options)
  expect(layout.routes).toHaveLength(diagram.edges.length)
  expect(layout.bounds.has("core")).toBe(false)
  const frame = layout.subgraphBounds.get("core")!
  for (const route of layout.routes) {
    const end = route.points.at(-1)!
    expect(grid.getCell(end.x, end.y)?.char).toBe(diagramArrowHeadBetween(route.points.at(-2)!, end))
    if (!route.edge.sourceArrowhead) continue
    const start = route.points[0]!
    const connector = flowchartSourceConnector(layout.bounds.get(route.edge.from)!, start)
    expect(grid.getCell(start.x, start.y)?.char).toBe(diagramArrowHeadBetween(start, connector))
    for (const point of orthogonalPathPoints(route.points)) {
      expect(grid.getCell(point.x, point.y)?.style).not.toBe("label")
      expect(grid.getCell(point.x, point.y)?.char).not.toBe(" ")
      expect(
        point.x > frame.left &&
          point.x < frame.left + frame.width - 1 &&
          point.y > frame.top &&
          point.y < frame.top + frame.height - 1,
      ).toBe(true)
    }
  }
  for (const id of ["schema", "protocol", "server", "cli", "sdk"]) {
    const node = layout.bounds.get(id)!
    expect(
      node.left < frame.left + frame.width &&
        node.left + node.width > frame.left &&
        node.top < frame.top + frame.height &&
        node.top + node.height > frame.top,
    ).toBe(false)
  }
})

test("renders a single-line bidirectional label with connected stems on both sides", () => {
  expectDiagram(renderFlowchartDiagram("flowchart LR\nA <-->|exchange| B", { compact: true })).toEqualDiagram(`
    ╭───╮                 ╭───╮
    │ A ├◀── exchange ───▶│ B │
    ╰───╯                 ╰───╯
  `)
})

test("renders multiline horizontal labels above a continuous bidirectional edge", () => {
  expectDiagram(renderFlowchartDiagram("flowchart LR\nA <-->|first<br/>second| B", { compact: true })).toEqualDiagram(`
             first
    ╭───╮    second     ╭───╮
    │ A ├◀─────────────▶│ B │
    ╰───╯               ╰───╯
  `)
})

test("renders a bare slash ID as literal text", () => {
  expect(renderFlowchartDiagram("flowchart LR\nserver --> cli/tui")).toContain("cli/tui")
})

test("keeps edges to an empty declared subgraph", () => {
  const source = "flowchart TD\nA --> G\nsubgraph G[Empty]\nend\nG --> B"
  const diagram = parseMermaidFlowchartDiagram(source)
  const layout = layoutFlowchartDiagram(diagram, { compact: true })
  const grid = drawFlowchartDiagramGrid(diagram, { compact: true })
  expect(layout.routes).toHaveLength(2)
  expect(layout.bounds.has("G")).toBe(false)
  expect(layout.subgraphBounds.has("G")).toBe(true)
  expect(grid.toString()).toContain("Empty")
  for (const route of layout.routes) {
    const end = route.points.at(-1)!
    expect(grid.getCell(end.x, end.y)?.char).toBe(diagramArrowHeadBetween(route.points.at(-2)!, end))
  }
})

test.each(["", "exchange", "one<br/>two"])(
  "does not overwrite a frame's source connector with its title: %s",
  (label) => {
    const diagram = parseMermaidFlowchartDiagram(
      `flowchart BT\nsubgraph G[Group title]\nA\nend\nG <-->${label ? `|${label}|` : ""} X`,
    )
    const layout = layoutFlowchartDiagram(diagram, { compact: true })
    const grid = drawFlowchartDiagramGrid(diagram, { compact: true })
    const start = layout.routes[0]!.points[0]!
    const connector = flowchartSourceConnector({ ...layout.subgraphBounds.get("G")!, lines: [] }, start)
    expect(grid.getCell(connector.x, connector.y)?.style).toBe("edge")
    expect(grid.getCell(connector.x, connector.y)?.char).toBe(connector.char)
    expect(grid.toString()).toContain("Group title")
  },
)

test.each(["exchange", "one<br/>two"])("reserves label clearance between a horizontal frame and node: %s", (label) => {
  const diagram = parseMermaidFlowchartDiagram(`flowchart LR\nsubgraph G[Group title]\nA\nend\nG <-->|${label}| X`)
  const layout = layoutFlowchartDiagram(diagram, { compact: true })
  const grid = drawFlowchartDiagramGrid(diagram, { compact: true })
  const route = layout.routes[0]!
  expect(route.points).toHaveLength(2)
  const points = orthogonalPathPoints(route.points)
  expect(new Set(points.map((point) => `${point.x}:${point.y}`)).size).toBe(points.length)
  const placed = flowchartRouteLabelLayout(route, visualLength)
  for (const line of placed.lines) expect(grid.toString()).toContain(line.trim())
  const start = route.points[0]!
  const end = route.points.at(-1)!
  expect(grid.getCell(start.x, start.y)?.char).toBe("◀")
  expect(grid.getCell(end.x, end.y)?.char).toBe("▶")
})

test.each(["TD", "BT", "LR", "RL"] as const)(
  "keeps boundary edges distinct around locally directed groups in %s",
  (direction) => {
    const local = direction === "LR" || direction === "RL" ? "TD" : "LR"
    const diagram = parseMermaidFlowchartDiagram(`flowchart ${direction}
subgraph G[Group]
direction ${local}
A --> B
end
Input --> G
G -->|exchange| Output`)
    const layout = layoutFlowchartDiagram(diagram, { compact: true })
    const grid = drawFlowchartDiagramGrid(diagram, { compact: true })
    expect(layout.routes).toHaveLength(3)
    for (const route of layout.routes) {
      expect(route.points.length).toBeGreaterThanOrEqual(2)
      const points = orthogonalPathPoints(route.points)
      expect(new Set(points.map((point) => `${point.x}:${point.y}`)).size).toBe(points.length)
      const end = route.points.at(-1)!
      expect(grid.getCell(end.x, end.y)?.char).toBe(diagramArrowHeadBetween(route.points.at(-2)!, end))
    }
    expect(grid.toString()).toContain("exchange")
  },
)

test("keeps a nested empty frame separate from its parent's nodes", () => {
  const diagram = parseMermaidFlowchartDiagram("flowchart TD\nsubgraph G\nsubgraph H[Empty]\nend\nA\nend\nX --> H")
  const layout = layoutFlowchartDiagram(diagram, { compact: true })
  const grid = drawFlowchartDiagramGrid(diagram, { compact: true })
  const empty = layout.subgraphBounds.get("H")!
  const node = layout.bounds.get("A")!
  expect(
    node.left < empty.left + empty.width &&
      node.left + node.width > empty.left &&
      node.top < empty.top + empty.height &&
      node.top + node.height > empty.top,
  ).toBe(false)
  expect(grid.toString()).toContain("Empty")
  const route = layout.routes[0]!
  const end = route.points.at(-1)!
  expect(grid.getCell(end.x, end.y)?.char).toBe(diagramArrowHeadBetween(route.points.at(-2)!, end))
})

test("separates nested empty frames and preserves their labeled boundary edge", () => {
  const diagram = parseMermaidFlowchartDiagram(
    "flowchart LR\nsubgraph G\nsubgraph H[First]\nend\nsubgraph I[Second]\nend\nH <-->|one<br/>two| I\nend",
  )
  const layout = layoutFlowchartDiagram(diagram, { compact: true })
  const grid = drawFlowchartDiagramGrid(diagram, { compact: true })
  const first = layout.subgraphBounds.get("H")!
  const second = layout.subgraphBounds.get("I")!
  expect(first.left + first.width).toBeLessThan(second.left)
  for (const label of ["First", "Second", "one", "two"]) expect(grid.toString()).toContain(label)
  const points = orthogonalPathPoints(layout.routes[0]!.points)
  expect(new Set(points.map((point) => `${point.x}:${point.y}`)).size).toBe(points.length)
})
