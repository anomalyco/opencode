import { describe, expect, test } from "bun:test"
import { parseColor, TextAttributes } from "@opentui/core"
import stringWidth from "string-width"
import { expectDiagram } from "../test/diagram.js"
import { drawFlowchartDiagramGrid as drawParsedFlowchartDiagramGrid } from "./drawing.js"
import {
  DEFAULT_MIN_RANK_GAP,
  DEFAULT_MIN_VERTICAL_RANK_GAP,
  layoutFlowchartDiagram as layoutParsedFlowchartDiagram,
  visualLength,
} from "./layout.js"
import { flowchartEdgeLabelLayout, flowchartRouteLabelLayout } from "./labels.js"
import { parseMermaidFlowchartDiagram } from "./parser.js"
import { renderFlowchartDiagram } from "./render.js"
import { flowchartSourceConnector } from "./routing.js"
import { renderGridStyledText, resolveFlowchartStyleColors } from "./style.js"

function drawFlowchartDiagramGrid(content: string, options?: Parameters<typeof drawParsedFlowchartDiagramGrid>[1]) {
  return drawParsedFlowchartDiagramGrid(parseMermaidFlowchartDiagram(content), options)
}

function layoutFlowchartDiagram(content: string, options?: Parameters<typeof layoutParsedFlowchartDiagram>[1]) {
  return layoutParsedFlowchartDiagram(parseMermaidFlowchartDiagram(content), options)
}

function routeRunsAlongHorizontalBorder(
  route: { points: readonly { x: number; y: number }[] },
  bounds: { left: number; top: number; width: number; height: number },
): boolean {
  const borderYs = new Set([bounds.top, bounds.top + bounds.height - 1])
  const left = bounds.left
  const right = bounds.left + bounds.width - 1

  for (let index = 1; index < route.points.length; index++) {
    const from = route.points[index - 1]!
    const to = route.points[index]!
    if (from.y !== to.y || !borderYs.has(from.y)) continue
    if (Math.max(from.x, to.x) >= left && Math.min(from.x, to.x) <= right) return true
  }
  return false
}

function routeRunsAlongVerticalBorder(
  route: { points: readonly { x: number; y: number }[] },
  bounds: { left: number; top: number; width: number; height: number },
): boolean {
  const borderXs = new Set([bounds.left, bounds.left + bounds.width - 1])
  const top = bounds.top
  const bottom = bounds.top + bounds.height - 1

  for (let index = 1; index < route.points.length; index++) {
    const from = route.points[index - 1]!
    const to = route.points[index]!
    if (from.x !== to.x || !borderXs.has(from.x)) continue
    if (Math.max(from.y, to.y) >= top && Math.min(from.y, to.y) <= bottom) return true
  }
  return false
}

function routeIntersectsBounds(
  route: { points: readonly { x: number; y: number }[] },
  bounds: { left: number; top: number; width: number; height: number },
): boolean {
  const right = bounds.left + bounds.width - 1
  const bottom = bounds.top + bounds.height - 1
  for (let index = 1; index < route.points.length; index++) {
    const from = route.points[index - 1]!
    const to = route.points[index]!
    if (from.x === to.x) {
      if (
        from.x >= bounds.left &&
        from.x <= right &&
        Math.max(from.y, to.y) >= bounds.top &&
        Math.min(from.y, to.y) <= bottom
      ) {
        return true
      }
    } else if (
      from.y >= bounds.top &&
      from.y <= bottom &&
      Math.max(from.x, to.x) >= bounds.left &&
      Math.min(from.x, to.x) <= right
    ) {
      return true
    }
  }
  return false
}

function terminalPointsTowardBounds(
  route: { points: readonly { x: number; y: number }[] },
  bounds: { left: number; top: number; width: number; height: number },
): boolean {
  const before = route.points.at(-2)!
  const end = route.points.at(-1)!
  const right = bounds.left + bounds.width - 1
  const bottom = bounds.top + bounds.height - 1
  if (end.x === bounds.left - 1 && end.y >= bounds.top && end.y <= bottom) return before.x < end.x && before.y === end.y
  if (end.x === right + 1 && end.y >= bounds.top && end.y <= bottom) return before.x > end.x && before.y === end.y
  if (end.y === bounds.top - 1 && end.x >= bounds.left && end.x <= right) return before.y < end.y && before.x === end.x
  if (end.y === bottom + 1 && end.x >= bounds.left && end.x <= right) return before.y > end.y && before.x === end.x
  return false
}

function boundsIntersect(
  left: { left: number; top: number; width: number; height: number },
  right: { left: number; top: number; width: number; height: number },
): boolean {
  return (
    left.left <= right.left + right.width - 1 &&
    left.left + left.width - 1 >= right.left &&
    left.top <= right.top + right.height - 1 &&
    left.top + left.height - 1 >= right.top
  )
}

function expectFlowchartRoutesAvoidUnrelatedNodes(layout: ReturnType<typeof layoutFlowchartDiagram>): void {
  for (const route of layout.routes) {
    for (const [id, bounds] of layout.bounds) {
      if (id === route.edge.from || id === route.edge.to) continue
      expect(routeIntersectsBounds(route, bounds)).toBe(false)
    }
  }
}

function expectFinalFlowchartLabelLayoutUnobstructed(layout: ReturnType<typeof layoutFlowchartDiagram>) {
  const labels = layout.routes.map((route) => {
    const label = flowchartRouteLabelLayout(route, visualLength)
    return {
      route,
      label,
      bounds: { left: label.point.x, top: label.point.y, width: label.width, height: label.height },
    }
  })

  for (const [index, label] of labels.entries()) {
    for (const bounds of layout.bounds.values()) expect(boundsIntersect(label.bounds, bounds)).toBe(false)
    for (const [otherIndex, other] of labels.entries()) {
      if (otherIndex !== index) expect(boundsIntersect(label.bounds, other.bounds)).toBe(false)
    }
    const textBounds = { ...label.bounds, left: label.bounds.left + 1, width: label.bounds.width - 2 }
    for (const other of layout.routes) {
      if (other === label.route) continue
      expect(routeIntersectsBounds(other, textBounds)).toBe(false)
      const source = layout.bounds.get(other.edge.from)
      const sourcePoint = other.points[0]
      if (!source || !sourcePoint) continue
      const connector = flowchartSourceConnector(source, sourcePoint)
      expect(boundsIntersect(label.bounds, { left: connector.x, top: connector.y, width: 1, height: 1 })).toBe(false)
      expect(boundsIntersect(label.bounds, { left: sourcePoint.x, top: sourcePoint.y, width: 1, height: 1 })).toBe(
        false,
      )
    }
  }
  return labels
}

function expectFlowchartLabelsUnobstructed(content: string): ReturnType<typeof layoutFlowchartDiagram> {
  const output = renderFlowchartDiagram(content)
  const layout = layoutFlowchartDiagram(content)
  const labels = expectFinalFlowchartLabelLayoutUnobstructed(layout)
  const grid = drawFlowchartDiagramGrid(content)

  for (const label of labels) {
    const escaped = label.route.edge.label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    expect(output.match(new RegExp(`(?<![\\p{L}\\p{N}_])${escaped}(?![\\p{L}\\p{N}_])`, "gu")) ?? []).toHaveLength(1)
    for (const [lineIndex, line] of label.label.lines.entries()) {
      for (let offset = 0; offset < visualLength(line); offset++) {
        expect(grid.getCell(label.label.point.x + offset, label.label.point.y + lineIndex)?.style).toBe("label")
      }
    }
  }
  expectFlowchartRoutesAvoidUnrelatedNodes(layout)
  return layout
}

describe("FlowchartDiagram", () => {
  test("renders compact horizontal flowcharts with shorter routes", () => {
    const output = renderFlowchartDiagram(
      `flowchart LR
  A[Idea] --> B[Parse]
  B --> C[Render]
  C --> D[Terminal]`,
      { compact: true },
    )

    expectDiagram(output).toEqualDiagram(`
      ╭──────╮    ╭───────╮    ╭────────╮    ╭──────────╮
      │ Idea ├───▶│ Parse ├───▶│ Render ├───▶│ Terminal │
      ╰──────╯    ╰───────╯    ╰────────╯    ╰──────────╯
    `)
  })

  test("renders compact vertical flowcharts with a readable arrow stem", () => {
    const output = renderFlowchartDiagram(
      `flowchart TD
  A[Start] --> B[Done]`,
      { compact: true },
    )

    expectDiagram(output).toEqualDiagram(`
      ╭───────╮
      │ Start │
      ╰───┬───╯
          │
          ▼
      ╭──────╮
      │ Done │
      ╰──────╯
    `)
  })

  test("routes compact vertical sibling subtrees from their true parents", () => {
    const output = renderFlowchartDiagram(
      `flowchart TD
  D[DEPLOYMENT - Anomaly] --> CA[ClientApps: google, github]
  D --> O[ORG acme = guild/workspace]
  O --> OG[org grant: google, authed as bot@acme.com]
  O --> M[MEMBER juliana]
  M --> UG[user grant: google, personal]`,
      { compact: true },
    )

    expectDiagram(output).toEqualDiagram(`
                               ╭──────────────────────╮
                               │ DEPLOYMENT - Anomaly │
                               ╰───────────┬──────────╯
                      ╭────────────────────╰────────────────────╮
                      ▼                                         ▼
       ╭────────────────────────────╮            ╭────────────────────────────╮
       │ ClientApps: google, github │            │ ORG acme = guild/workspace │
       ╰────────────────────────────╯            ╰──────────────┬─────────────╯
                            ╭───────────────────────────────────╰───────╮
                            ▼                                           ▼
      ╭───────────────────────────────────────────╮            ╭────────────────╮
      │ org grant: google, authed as bot@acme.com │            │ MEMBER juliana │
      ╰───────────────────────────────────────────╯            ╰────────┬───────╯
                                           ╭────────────────────────────╯
                                           ▼
                           ╭──────────────────────────────╮
                           │ user grant: google, personal │
                           ╰──────────────────────────────╯
    `)
  })

  test("routes vertical sibling subtrees from their true parents", () => {
    const output = renderFlowchartDiagram(`flowchart TD
  D[DEPLOYMENT - Anomaly] --> CA[ClientApps: google, github]
  D --> O[ORG acme = guild/workspace]
  O --> OG[org grant: google, authed as bot@acme.com]
  O --> M[MEMBER juliana]
  M --> UG[user grant: google, personal]`)

    expectDiagram(output).toEqualDiagram(`
                               ╭──────────────────────╮
                               │ DEPLOYMENT - Anomaly │
                               ╰───────────┬──────────╯
                                           │
                      ╭────────────────────┴────────────────────╮
                      │                                         │
                      ▼                                         ▼
       ╭────────────────────────────╮            ╭────────────────────────────╮
       │ ClientApps: google, github │            │ ORG acme = guild/workspace │
       ╰────────────────────────────╯            ╰──────────────┬─────────────╯
                                                                │
                            ╭───────────────────────────────────┴───────╮
                            │                                           │
                            ▼                                           ▼
      ╭───────────────────────────────────────────╮            ╭────────────────╮
      │ org grant: google, authed as bot@acme.com │            │ MEMBER juliana │
      ╰───────────────────────────────────────────╯            ╰────────┬───────╯
                                                                        │
                                           ╭────────────────────────────╯
                                           │
                                           ▼
                           ╭──────────────────────────────╮
                           │ user grant: google, personal │
                           ╰──────────────────────────────╯
    `)
  })

  test("keeps Unicode node labels inside their measured frame", () => {
    const output = renderFlowchartDiagram(`flowchart LR
  A[界]`)
    const widths = output.split("\n").map((line) => stringWidth(line))

    expect(new Set(widths).size).toBe(1)
    expect(output).toContain("界")
  })

  test("does not mutate a parsed diagram when laying out with a direction override", () => {
    const diagram = parseMermaidFlowchartDiagram(`flowchart LR
  A --> B`)

    layoutParsedFlowchartDiagram(diagram, { direction: "RL" })

    expect(diagram.direction).toBe("LR")
  })

  test("does not draw reverse-flow arrowheads on a target's opposite side", () => {
    const content = `flowchart RL
  Parser[Parser] --> Output[Rendered]`
    const output = renderFlowchartDiagram(content)
    const layout = layoutFlowchartDiagram(content)
    const outputBounds = layout.bounds.get("Output")!
    const renderedRow = output.split("\n").find((line) => line.includes("Rendered"))!

    const horizontalRoute = layout.routes.find((route) => route.edge.from === "Parser" && route.edge.to === "Output")!
    expect(horizontalRoute.points.at(-1)?.x).toBe(outputBounds.left + outputBounds.width)
    expect(renderedRow).toContain("│ Rendered │◀")
    expect(renderedRow.trimStart().startsWith("◀")).toBe(false)
  })

  test("preserves arrowheads for horizontal cycles", () => {
    const output = renderFlowchartDiagram(`flowchart LR
  A[A] --> B[B]
  B --> A`)

    expectDiagram(output).toEqualDiagram(`
        ╭───────────╮
        │           │
        │           │
        ▼           │
      ╭───╮       ╭─┴─╮
      │ A ├──────▶│ B │
      ╰───╯       ╰───╯
    `)
  })

  test("keeps vertical feedback labels clear of unrelated nodes", () => {
    const content = `flowchart TD
  S[Source] --> A[Alpha]
  S --> B{Beta?}
  S --> C[(Store)]
  A --> J[[Join]]
  B --> J
  C --> J
  J -->|cycle back| S`
    const layout = layoutFlowchartDiagram(content)
    const feedback = layout.routes.find((route) => route.edge.from === "J" && route.edge.to === "S")!
    const label = flowchartEdgeLabelLayout(feedback.points, feedback.edge.label, stringWidth)
    const labelBounds = { left: label.point.x, top: label.point.y, width: label.width, height: label.height }

    for (const id of ["A", "B", "C"]) expect(boundsIntersect(labelBounds, layout.bounds.get(id)!)).toBe(false)
    expect(renderFlowchartDiagram(content)).toContain("cycle back")
  })

  test("routes horizontal feedback edges around sibling nodes", () => {
    for (const direction of ["LR", "RL"] as const) {
      const layout = layoutFlowchartDiagram(`flowchart ${direction}
  S[Start] --> D{Ready?}
  D --> O[Output]
  D --> R[Retry]
  R --> S`)
      const feedback = layout.routes.find((route) => route.edge.from === "R" && route.edge.to === "S")!

      expect(routeIntersectsBounds(feedback, layout.bounds.get("O")!)).toBe(false)
    }
  })

  test("keeps compact vertical fan-in arrowheads pointed at the target", () => {
    const content = `flowchart TD
  A[Left] -->|left| C[Merge]
  B[Right] -->|right| C`
    const layout = layoutFlowchartDiagram(content, { compact: true })

    for (const route of layout.routes) {
      const beforeTarget = route.points.at(-2)!
      const target = route.points.at(-1)!
      expect(beforeTarget.x).toBe(target.x)
      expect(beforeTarget.y).toBeLessThan(target.y)
    }
    expect(renderFlowchartDiagram(content, { compact: true })).toContain("▼")
  })

  test("routes same-rank vertical-flow edges into the target side", () => {
    const layout = layoutFlowchartDiagram(`flowchart TD
  B[Start] --> D{Choose}
  D --> E[[Primary]]
  D --> F[Fallback]
  E --> B
  F --> E`)
    const route = layout.routes.find((candidate) => candidate.edge.from === "F" && candidate.edge.to === "E")!
    const beforeTarget = route.points.at(-2)!
    const target = route.points.at(-1)!

    expect(beforeTarget.y).toBe(target.y)
    expect(beforeTarget.x).toBeGreaterThan(target.x)
  })

  test("renders parallel same-endpoint edges without losing labels", () => {
    const content = `flowchart LR
  A[Source] -->|first| B[Target]
  A -->|second| B`
    const output = renderFlowchartDiagram(content)
    const parallel = layoutFlowchartDiagram(content).routes

    expect(output).toContain("first")
    expect(output).toContain("second")
    expect(output).toMatch(/[▲▼◀▶]/)
    expect(new Set(parallel.map((route) => JSON.stringify(route.points))).size).toBe(2)
  })

  test("keeps reciprocal edge labels disjoint from nodes, labels, and other routes", () => {
    const content = `flowchart TD
  A[A] -->|forward_label| B[B]
  B -->|backward_label| A`

    expectFlowchartLabelsUnobstructed(content)
  })

  test("keeps labeled parallel BT edges on distinct unobstructed routes", () => {
    const content = `flowchart BT
  F3_1[Node F3_1]
  F3_4[Node F3_4]
  F3_3[Node F3_3]
  F3_2[Node F3_2]
  F3_3 -->|flow_edge_3_0| F3_4
  F3_2 -->|flow_edge_3_1| F3_3
  F3_1 -->|flow_edge_3_5| F3_4
  F3_1 -->|flow_edge_3_6| F3_4
  F3_2 -->|flow_edge_3_7| F3_1
  F3_1 -->|flow_edge_3_8| F3_4`
    const layout = expectFlowchartLabelsUnobstructed(content)
    const parallel = layout.routes.filter((route) => route.edge.from === "F3_1" && route.edge.to === "F3_4")

    expect(parallel).toHaveLength(3)
    expect(new Set(parallel.map((route) => JSON.stringify(route.points))).size).toBe(3)
  })

  test("keeps every label in the cyclic parallel BT fuzz fixture", () => {
    const content = `flowchart BT
  F3_0[Node F3_0]
  F3_1[Node F3_1]
  F3_2[Node F3_2]
  F3_3[Node F3_3]
  F3_4[Node F3_4]
  F3_0 -->|flow_edge_3_0| F3_1
  F3_1 -->|flow_edge_3_1| F3_2
  F3_2 -->|flow_edge_3_2| F3_3
  F3_3 -->|flow_edge_3_3| F3_4
  F3_0 -->|flow_edge_3_4| F3_4
  F3_0 -->|flow_edge_3_5| F3_0
  F3_1 -->|flow_edge_3_6| F3_4
  F3_3 -->|flow_edge_3_7| F3_0
  F3_1 -->|flow_edge_3_8| F3_4
  F3_3 -->|flow_edge_3_9| F3_0`

    expectFlowchartLabelsUnobstructed(content)
  })

  test("keeps every label in the cyclic parallel TB fuzz fixture", () => {
    const content = `flowchart TB
  F9_0[Node F9_0]
  F9_1[Node F9_1]
  F9_2[Node F9_2]
  F9_3[Node F9_3]
  F9_4[Node F9_4]
  F9_5[Node F9_5]
  F9_6[Node F9_6]
  F9_0 -->|flow_edge_9_0| F9_1
  F9_1 -->|flow_edge_9_1| F9_2
  F9_2 -->|flow_edge_9_2| F9_3
  F9_3 -->|flow_edge_9_3| F9_4
  F9_4 -->|flow_edge_9_4| F9_5
  F9_5 -->|flow_edge_9_5| F9_6
  F9_2 -->|flow_edge_9_6| F9_3
  F9_1 -->|flow_edge_9_7| F9_0
  F9_5 -->|flow_edge_9_8| F9_6
  F9_6 -->|flow_edge_9_9| F9_3
  F9_0 -->|flow_edge_9_10| F9_1
  F9_1 -->|flow_edge_9_11| F9_5`

    expectFlowchartLabelsUnobstructed(content)
  })

  test("keeps routes outside unrelated nodes in the cyclic TB fuzz fixture", () => {
    const content = `flowchart TB
  F7_0[Node F7_0]
  F7_1[Node F7_1]
  F7_2[Node F7_2]
  F7_3[Node F7_3]
  F7_4[Node F7_4]
  F7_5[Node F7_5]
  F7_6[Node F7_6]
  F7_7[Node F7_7]
  F7_0 -->|flow_edge_7_0| F7_1
  F7_1 -->|flow_edge_7_1| F7_2
  F7_2 -->|flow_edge_7_2| F7_3
  F7_3 -->|flow_edge_7_3| F7_4
  F7_4 -->|flow_edge_7_4| F7_5
  F7_5 -->|flow_edge_7_5| F7_6
  F7_6 -->|flow_edge_7_6| F7_7
  F7_7 -->|flow_edge_7_7| F7_2
  F7_3 -->|flow_edge_7_8| F7_3
  F7_0 -->|flow_edge_7_9| F7_4
  F7_5 -->|flow_edge_7_10| F7_6
  F7_4 -->|flow_edge_7_11| F7_2`

    expectFlowchartLabelsUnobstructed(content)
  })

  test("keeps every label clear in the cyclic BT fuzz fixture", () => {
    const content = `flowchart BT
  F130_0[Node F130_0]
  F130_1[Node F130_1]
  F130_2[Node F130_2]
  F130_3[Node F130_3]
  F130_4[Node F130_4]
  F130_5[Node F130_5]
  F130_0 -->|flow_edge_130_0| F130_1
  F130_1 -->|flow_edge_130_1| F130_2
  F130_2 -->|flow_edge_130_2| F130_3
  F130_3 -->|flow_edge_130_3| F130_4
  F130_4 -->|flow_edge_130_4| F130_5
  F130_2 -->|flow_edge_130_5| F130_1
  F130_4 -->|flow_edge_130_6| F130_3
  F130_3 -->|flow_edge_130_7| F130_1
  F130_5 -->|flow_edge_130_8| F130_5
  F130_2 -->|flow_edge_130_9| F130_0
  F130_4 -->|flow_edge_130_10| F130_0
  F130_4 -->|flow_edge_130_11| F130_0`

    expectFlowchartLabelsUnobstructed(content)
  })

  test("keeps translated top feedback labels distinct in the cyclic BT fuzz fixture", () => {
    const content = `flowchart BT
  F141_0[Node F141_0]
  F141_1[Node F141_1]
  F141_2[Node F141_2]
  F141_3[Node F141_3]
  F141_4[Node F141_4]
  F141_5[Node F141_5]
  F141_6[Node F141_6]
  F141_7[Node F141_7]
  F141_0 -->|flow_edge_141_0| F141_1
  F141_1 -->|flow_edge_141_1| F141_2
  F141_2 -->|flow_edge_141_2| F141_3
  F141_3 -->|flow_edge_141_3| F141_4
  F141_4 -->|flow_edge_141_4| F141_5
  F141_5 -->|flow_edge_141_5| F141_6
  F141_6 -->|flow_edge_141_6| F141_7
  F141_7 -->|flow_edge_141_7| F141_1
  F141_4 -->|flow_edge_141_8| F141_4
  F141_3 -->|flow_edge_141_9| F141_0
  F141_3 -->|flow_edge_141_10| F141_2
  F141_7 -->|flow_edge_141_11| F141_6
  F141_7 -->|flow_edge_141_12| F141_2
  F141_7 -->|flow_edge_141_13| F141_5`

    expectFlowchartLabelsUnobstructed(content)
  })

  test("keeps feedback labels outside their endpoint nodes in the cyclic BT fuzz fixture", () => {
    const content = `flowchart BT
  F223_0[Node F223_0]
  F223_1[Node F223_1]
  F223_2[Node F223_2]
  F223_3[Node F223_3]
  F223_4[Node F223_4]
  F223_5[Node F223_5]
  F223_6[Node F223_6]
  F223_0 -->|flow_edge_223_0| F223_1
  F223_1 -->|flow_edge_223_1| F223_2
  F223_2 -->|flow_edge_223_2| F223_3
  F223_3 -->|flow_edge_223_3| F223_4
  F223_4 -->|flow_edge_223_4| F223_5
  F223_5 -->|flow_edge_223_5| F223_6
  F223_5 -->|flow_edge_223_6| F223_2
  F223_2 -->|flow_edge_223_7| F223_6
  F223_3 -->|flow_edge_223_8| F223_6`

    expectFlowchartLabelsUnobstructed(content)
  })

  test("keeps self-loop labels outside their node in the cyclic TB fuzz fixture", () => {
    const content = `flowchart TB
  F238_0[Node F238_0]
  F238_1[Node F238_1]
  F238_2[Node F238_2]
  F238_3[Node F238_3]
  F238_4[Node F238_4]
  F238_5[Node F238_5]
  F238_0 -->|flow_edge_238_0| F238_1
  F238_1 -->|flow_edge_238_1| F238_2
  F238_2 -->|flow_edge_238_2| F238_3
  F238_3 -->|flow_edge_238_3| F238_4
  F238_4 -->|flow_edge_238_4| F238_5
  F238_1 -->|flow_edge_238_5| F238_2
  F238_3 -->|flow_edge_238_6| F238_3
  F238_2 -->|flow_edge_238_7| F238_0
  F238_1 -->|flow_edge_238_8| F238_5
  F238_1 -->|flow_edge_238_9| F238_1
  F238_4 -->|flow_edge_238_10| F238_4
  F238_4 -->|flow_edge_238_11| F238_0
  F238_2 -->|flow_edge_238_12| F238_2`

    expectFlowchartLabelsUnobstructed(content)
  })

  test.each(["LR", "RL", "TD", "TB", "BT"] as const)(
    "keeps multiple %s self-loop labels clear amid surrounding cycles",
    (direction) => {
      const content = `flowchart ${direction}
  A[Alpha] -->|entry_${direction}| B[Beta]
  B -->|loop_${direction}_0| B
  B -->|loop_${direction}_1| B
  B -->|loop_${direction}_2| B
  B -->|exit_${direction}| C[Gamma]
  C -->|cycle_${direction}| A`
      const layout = expectFlowchartLabelsUnobstructed(content)
      const loops = layout.routes.filter((route) => route.edge.from === "B" && route.edge.to === "B")

      expect(loops).toHaveLength(3)
    },
  )

  test.each(
    (["LR", "RL", "TD", "TB", "BT"] as const).flatMap((direction) =>
      ([2, 3, 4] as const).map((count) => ({ direction, count })),
    ),
  )("keeps $count parallel $direction labels clear amid surrounding cycles", ({ direction, count }) => {
    const parallel = Array.from({ length: count }, (_, index) => `  A -->|parallel_${direction}_${count}_${index}| B`)
    const content = [
      `flowchart ${direction}`,
      "  S[Source] -->|entry| A[Alpha]",
      ...parallel,
      "  B[Beta] -->|exit| T[Target]",
      "  B -->|reciprocal| A",
      "  T -->|cycle| S",
    ].join("\n")
    const layout = expectFlowchartLabelsUnobstructed(content)
    const parallelRoutes = layout.routes.filter((route) => route.edge.from === "A" && route.edge.to === "B")

    expect(parallelRoutes).toHaveLength(count)
    expect(new Set(parallelRoutes.map((route) => JSON.stringify(route.points))).size).toBe(count)
  })

  test("keeps three parallel multiline edges legible in both orientations", () => {
    const horizontal = renderFlowchartDiagram(`flowchart LR
  A[Source] -->|first 1<br/>first 2<br/>first 3<br/>first 4| B[Target]
  A -->|second 1<br/>second 2<br/>second 3<br/>second 4| B
  A -->|third 1<br/>third 2<br/>third 3<br/>third 4| B`)
    const vertical = renderFlowchartDiagram(`flowchart TD
  A[Source] -->|first lane<br/>first two| B[Target]
  A -->|second lane<br/>second two| B
  A -->|third lane<br/>third two| B`)

    for (const label of ["second 1", "second 2", "second 3", "second 4", "third 1", "third 2"]) {
      expect(horizontal).toContain(label)
    }
    for (const label of ["first lane", "first two", "second lane", "second two", "third lane", "third two"]) {
      expect(vertical).toContain(label)
    }
  })

  test("keeps five parallel multiline edge labels distinct", () => {
    const output = renderFlowchartDiagram(`flowchart TD
  A[Source] -->|one alpha<br/>one beta| B[Target]
  A -->|two alpha<br/>two beta| B
  A -->|three alpha<br/>three beta| B
  A -->|four alpha<br/>four beta| B
  A -->|five alpha<br/>five beta| B`)

    for (const number of ["one", "two", "three", "four", "five"]) {
      expect(output.match(new RegExp(`${number} alpha`, "g"))).toHaveLength(1)
      expect(output.match(new RegExp(`${number} beta`, "g"))).toHaveLength(1)
    }
  })

  test("does not reserve label gaps for unlabeled fan-out", () => {
    const output = renderFlowchartDiagram(`flowchart TD
  S[The Boss] --> A[A]
  S --> B[B]
  S --> C[C]
  S --> D[D]
  S --> E[E]
  S --> F[F]
  S --> G[G]
  S --> H[H]
  S --> I[I]
  S --> J[J]`)

    expect(Math.max(...output.split("\n").map((line) => stringWidth(line)))).toBeLessThanOrEqual(100)
  })

  test("keeps transitive targets below intermediate vertical stages", () => {
    const content = `flowchart TD
  A[Start] --> B[Validate]
  B --> C[Publish]
  A --> C`
    const layout = layoutFlowchartDiagram(content)
    const output = renderFlowchartDiagram(content)

    expect(layout.bounds.get("C")!.top).toBeGreaterThan(layout.bounds.get("B")!.top)
    expect(output.match(/[▼◀]/g)).toHaveLength(3)
  })

  test("routes transitive horizontal shortcuts around intermediate stages", () => {
    const content = `flowchart LR
  A[Start] --> B[Validate]
  B --> C[Publish]
  A --> C`
    const layout = layoutFlowchartDiagram(content)
    const output = renderFlowchartDiagram(content)

    expect(layout.bounds.get("C")!.left).toBeGreaterThan(layout.bounds.get("B")!.left)
    expect(output.match(/[▶▼]/g)).toHaveLength(3)
  })

  test("folds oversized horizontal activity pipelines into a readable vertical layout", () => {
    const output = renderFlowchartDiagram(
      `flowchart LR
  C[ReceiveInput] --> P[Persist ActivityRequested]
  P --> S[Self RunPendingActivity]
  S --> O[OpenCode async task]
  O --> M[Self OutputObserved]
  M --> E[Persist OutputObserved]`,
      { layoutMaxWidth: 120 },
    )

    expectDiagram(output).toEqualDiagram(`
            ╭──────────────╮
            │ ReceiveInput │
            ╰───────┬──────╯
                    │
                    │
                    │
                    ▼
      ╭───────────────────────────╮
      │ Persist ActivityRequested │
      ╰─────────────┬─────────────╯
                    │
                    │
                    │
                    ▼
       ╭─────────────────────────╮
       │ Self RunPendingActivity │
       ╰────────────┬────────────╯
                    │
                    │
                    │
                    ▼
         ╭─────────────────────╮
         │ OpenCode async task │
         ╰──────────┬──────────╯
                    │
                    │
                    │
                    ▼
         ╭─────────────────────╮
         │ Self OutputObserved │
         ╰──────────┬──────────╯
                    │
                    │
                    │
                    ▼
       ╭────────────────────────╮
       │ Persist OutputObserved │
       ╰────────────────────────╯
    `)
  })

  test("folds oversized horizontal feedback pipelines without losing labeled routes", () => {
    const output = renderFlowchartDiagram(
      `flowchart LR
  C[Commands] --> A[AgentThread activation]
  A -->|persist facts| J[(AgentThread journal)]
  A -->|resume / steer / abort| O[OpenCode session]
  O -->|observed output| A
  J -->|visible output requested| R[Reactor]
  R --> D[Discord]`,
      { layoutMaxWidth: 120 },
    )

    expectDiagram(output).toEqualDiagram(`
                                      ╭──────────╮
                                      │ Commands │
                                      ╰─────┬────╯
                                            │
                                            │
                                            │
                                            ▼
                               ╭────────────────────────╮
                               │ AgentThread activation │◀───── observed output ─────╮
                               ╰────────────┬───────────╯                            │
                                            │                                        │
                 ╭───── persist facts ──────┴── resume / steer / abort ──╮           │
                 │                                                       │           │
                 ▼                                                       │           │
      ╭─────────────────────╮                                            ▼           │
      ├─────────────────────┤                                  ╭──────────────────╮  │
      │ AgentThread journal │                                  │ OpenCode session ├──╯
      ├─────────────────────┤                                  ╰──────────────────╯
      ╰──────────┬──────────╯
                 │
                 ╰ visible output requested ╮
                                            │
                                            ▼
                                       ╭─────────╮
                                       │ Reactor │
                                       ╰────┬────╯
                                            │
                                            │
                                            │
                                            ▼
                                       ╭─────────╮
                                       │ Discord │
                                       ╰─────────╯
    `)
  })

  test("parses Mermaid flowchart nodes and standard arrows", () => {
    const diagram = parseMermaidFlowchartDiagram(`
flowchart TD
  Start([Start]):::focus --> Form[Collect Details]
  Form -->|valid| Store[(Orders DB)]:::store
  Form -- invalid --> Review(Manual Review)
  Review --> Decision{Approved?}
`)

    expect(diagram.direction).toBe("TD")
    expect(diagram.nodes).toEqual([
      { id: "Start", label: "Start", shape: "rounded" },
      { id: "Form", label: "Collect Details", shape: "box" },
      { id: "Store", label: "Orders DB", shape: "database" },
      { id: "Review", label: "Manual Review", shape: "rounded" },
      { id: "Decision", label: "Approved?", shape: "decision" },
    ])
    expect(diagram.edges).toEqual([
      { from: "Start", to: "Form", label: "" },
      { from: "Form", to: "Store", label: "valid" },
      { from: "Form", to: "Review", label: "invalid" },
      { from: "Review", to: "Decision", label: "" },
    ])
  })

  test("decodes HTML entities in node and edge labels", () => {
    const diagram = parseMermaidFlowchartDiagram(`flowchart LR
  A[HMAC verify &lt;3s &amp; continue] -->|result &#x2265; 1| B[Done]`)

    expect(diagram.nodes.find((node) => node.id === "A")?.label).toBe("HMAC verify <3s & continue")
    expect(diagram.edges[0]?.label).toBe("result ≥ 1")
  })

  test("preserves quoted multiline edge labels", () => {
    const diagram = parseMermaidFlowchartDiagram(`flowchart TD
  A -->|"fs: watcher/fff off<br/>events.persist: true<br/>mcp.stdio: false<br/>A --> B"| B`)

    expect(diagram.edges).toEqual([
      {
        from: "A",
        to: "B",
        label: "fs: watcher/fff off<br/>events.persist: true<br/>mcp.stdio: false<br/>A --> B",
      },
    ])
  })

  test("parses and renders each edge in a chained flowchart statement", () => {
    const content = `flowchart LR
  API --> Worker --> DB[(Database)]`
    const diagram = parseMermaidFlowchartDiagram(content)
    const output = renderFlowchartDiagram(content, { compact: true })

    expect(diagram.nodes).toEqual([
      { id: "API", label: "API", shape: "box" },
      { id: "Worker", label: "Worker", shape: "box" },
      { id: "DB", label: "Database", shape: "database" },
    ])
    expect(diagram.edges).toEqual([
      { from: "API", to: "Worker", label: "" },
      { from: "Worker", to: "DB", label: "" },
    ])
    expectDiagram(output).toEqualDiagram(`
                               ╭──────────╮
      ╭─────╮    ╭────────╮    ├──────────┤
      │ API ├───▶│ Worker ├───▶│ Database │
      ╰─────╯    ╰────────╯    ├──────────┤
                               ╰──────────╯
    `)
  })

  test("preserves labels and styles on every edge in a chain", () => {
    const diagram = parseMermaidFlowchartDiagram(`flowchart LR
  A -->|plain| B -.->|retry| C ==>|done| D`)

    expect(diagram.edges).toEqual([
      { from: "A", to: "B", label: "plain" },
      { from: "B", to: "C", label: "retry", style: "dashed" },
      { from: "C", to: "D", label: "done", style: "thick" },
    ])
  })

  test("parses chained undirected solid edges", () => {
    const diagram = parseMermaidFlowchartDiagram(`flowchart LR
  A --- B --- C`)

    expect(diagram.edges).toEqual([
      { from: "A", to: "B", label: "", arrowhead: false },
      { from: "B", to: "C", label: "", arrowhead: false },
    ])
  })

  test("parses labeled undirected dashed and bidirectional edges", () => {
    const diagram = parseMermaidFlowchartDiagram(`flowchart LR
  DB[(Durable Object SQLite)]
  API[Slack API]
  DB -. no shared transaction .- API
  API <--> DB`)

    expect(diagram.edges).toEqual([
      { from: "DB", to: "API", label: "no shared transaction", style: "dashed", arrowhead: false },
      { from: "API", to: "DB", label: "", sourceArrowhead: true },
    ])
    const dashedOutput = renderFlowchartDiagram(`flowchart LR
  DB[(Durable Object SQLite)] -. no shared transaction .- API[Slack API]`)
    const bidirectionalOutput = renderFlowchartDiagram(`flowchart LR
  DB[(Durable Object SQLite)] <--> API[Slack API]`)
    expect(dashedOutput).toContain("no shared transaction")
    expect(bidirectionalOutput.match(/[◀▶▲▼]/g)?.length).toBeGreaterThanOrEqual(2)
  })

  test("renders the volume persistence diagram with an undirected solid edge", () => {
    const content = `flowchart LR
    subgraph durable [Durable — survives everything]
        V[(Volume ws-wor_abc<br/>mounted at /workspace)]
        R[our row: id, provider]
    end
    subgraph ephemeral [Ephemeral — dies freely]
        S1[Sandbox #1] -. mounts .-> V
        S2[Sandbox #2<br/>Tuesday] -. mounts same .-> V
        X[apt-get installs,<br/>~/.cache, /tmp]
    end
    S1 --- X
    style X stroke-dasharray: 5 5`
    const diagram = parseMermaidFlowchartDiagram(content)
    const layout = layoutParsedFlowchartDiagram(diagram, { compact: true })
    const grid = drawParsedFlowchartDiagramGrid(diagram, { compact: true })
    const output = renderFlowchartDiagram(content, { compact: true })
    const route = layout.routes.find((route) => route.edge.from === "S1" && route.edge.to === "X")!
    const end = route.points.at(-1)!

    expect(diagram.edges.at(-1)).toEqual({ from: "S1", to: "X", label: "", arrowhead: false })
    expect(route.points.length).toBeGreaterThan(1)
    expect(grid.getCell(end.x, end.y)?.char).not.toMatch(/[▶▼◀▲]/)
    expectDiagram(output).toContainInOrder("Sandbox #1", "apt-get installs,", "~/.cache, /tmp")
  })

  test.each(["LR", "RL", "TD", "BT"] as const)(
    "keeps undirected %s routes continuous up to the target",
    (direction) => {
      const content = `flowchart ${direction}\n  A[Alpha] --- B[(Store)]`
      const diagram = parseMermaidFlowchartDiagram(content)
      const layout = layoutParsedFlowchartDiagram(diagram)
      const grid = drawParsedFlowchartDiagramGrid(diagram)
      const route = layout.routes[0]!

      expect(terminalPointsTowardBounds(route, layout.bounds.get("B")!)).toBe(true)
      for (let index = 1; index < route.points.length; index++) {
        const from = route.points[index - 1]!
        const to = route.points[index]!
        const length = Math.abs(to.x - from.x) + Math.abs(to.y - from.y)
        for (let offset = 0; offset <= length; offset++) {
          const x = from.x + Math.sign(to.x - from.x) * offset
          const y = from.y + Math.sign(to.y - from.y) * offset
          expect(grid.getCell(x, y)?.char).not.toBe(" ")
        }
      }
      expect(grid.getCell(route.points.at(-1)!.x, route.points.at(-1)!.y)?.char).toMatch(/[─│]/)
    },
  )

  test("keeps independent horizontal fan-out groups on distinct routes", () => {
    const content = `flowchart LR
  A[A] -->|A to X| X[X]
  A -->|A to Y| Y[Y]
  B[B] -->|B to Y| Y
  B -->|B to Z| Z[Z]`
    const output = renderFlowchartDiagram(content)
    const routes = layoutFlowchartDiagram(content).routes
    const routeByLabel = new Map(routes.map((route) => [route.edge.label, route]))

    for (const label of ["A to X", "A to Y", "B to Y", "B to Z"]) {
      expect(output.match(new RegExp(label, "g"))).toHaveLength(1)
    }
    expect(routeByLabel.get("A to X")!.points[1]!.x).toBe(routeByLabel.get("A to Y")!.points[1]!.x)
    expect(routeByLabel.get("B to Y")!.points[1]!.x).toBe(routeByLabel.get("B to Z")!.points[1]!.x)
    expect(routeByLabel.get("A to Y")!.points[1]!.x).not.toBe(routeByLabel.get("B to Y")!.points[1]!.x)
    expect(routeByLabel.get("A to Y")!.points.at(-1)).not.toEqual(routeByLabel.get("B to Y")!.points.at(-1))
  })

  test("parses and renders inline dashed edge labels", () => {
    const content = `flowchart TD
  CS[conformance suite<br/>same test cases pin every driver] -.verifies.-> LS
  CS -.verifies.-> MS
  CS -.verifies.-> MEM[memory driver]`
    const diagram = parseMermaidFlowchartDiagram(content)
    const output = renderFlowchartDiagram(content, { compact: true })

    expect(diagram.edges).toEqual([
      { from: "CS", to: "LS", label: "verifies", style: "dashed" },
      { from: "CS", to: "MS", label: "verifies", style: "dashed" },
      { from: "CS", to: "MEM", label: "verifies", style: "dashed" },
    ])
    expect(output.match(/verifies/g)).toHaveLength(3)
    expect(output).not.toContain("─ ─")
  })

  test("uses invisible subgraph links for ordering without rendering them", () => {
    const content = `flowchart LR
  subgraph before [Before]
    T1[read/edit/write/patch<br/>shell/grep/glob] --> F1[FSUtil / node:fs / AppProcess<br/>+ hosted branching in every tool]
  end
  subgraph after [After — merged this week]
    T2[same 8 tools] --> E[Environment<br/>files + spawner]
    E --> D{driver}
    D --> L[local<br/>node:fs]
    D --> M[Modal<br/>sandbox.exec]
    D --> Mem[memory<br/>tests]
  end
  before ~~~ after`
    const diagram = parseMermaidFlowchartDiagram(content)
    const layout = layoutParsedFlowchartDiagram(diagram, { compact: true })
    const output = renderFlowchartDiagram(content, { compact: true })

    expect(diagram.edges.at(-1)).toEqual({ from: "before", to: "after", label: "", orderOnly: true })
    expect(diagram.nodes.some((node) => node.id === "before" || node.id === "after")).toBe(false)
    expect(layout.routes).toHaveLength(diagram.edges.length - 1)
    expect(layout.routes.some((route) => route.edge.orderOnly)).toBe(false)
    expect(layout.subgraphBounds.get("before")!.left).toBeLessThan(layout.subgraphBounds.get("after")!.left)
    const chain = ["T2", "E", "D"].map((id) => layout.bounds.get(id)!)
    expect(chain.map((bounds) => bounds.centerY)).toEqual([chain[0]!.centerY, chain[0]!.centerY, chain[0]!.centerY])
    for (const route of layout.routes.filter((route) => route.edge.from === "T2" || route.edge.from === "E")) {
      expect(new Set(route.points.map((point) => point.y)).size).toBe(1)
    }
    expect(output).toContain("Before")
    expect(output).toContain("After — merged this week")
  })

  test("keeps every node and edge in a long chain distinct and in its subgraph", () => {
    const diagram = parseMermaidFlowchartDiagram(`flowchart LR
  subgraph Pipeline
    A --> B --> C --> D --> E --> F --> G --> H --> I --> J --> K --> L
  end`)

    expect(diagram.nodes.map((node) => node.id)).toEqual(["A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L"])
    expect(diagram.edges.map((edge) => `${edge.from}->${edge.to}`)).toEqual([
      "A->B",
      "B->C",
      "C->D",
      "D->E",
      "E->F",
      "F->G",
      "G->H",
      "H->I",
      "I->J",
      "J->K",
      "K->L",
    ])
    expect(diagram.subgraphs?.[0]?.nodeIds).toEqual(["A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L"])
  })

  test("parses bare subgraph nodes before a chained edge", () => {
    const diagram = parseMermaidFlowchartDiagram(`flowchart LR
  subgraph Services
    API
    Worker
  end
  API --> Worker --> DB[(Database)]`)

    expect(diagram.nodes.map((node) => node.id)).toEqual(["API", "Worker", "DB"])
    expect(diagram.edges.map((edge) => [edge.from, edge.to])).toEqual([
      ["API", "Worker"],
      ["Worker", "DB"],
    ])
    expect(diagram.subgraphs?.[0]?.nodeIds).toEqual(["API", "Worker"])
  })

  test("parses Mermaid subgraph groups", () => {
    const diagram = parseMermaidFlowchartDiagram(`
flowchart LR
  subgraph Web [Web App]
    UI[UI] --> API[API]
  end
  subgraph Platform
    API --> DB[(Database)]
  end
`)

    expect(diagram.subgraphs).toEqual([
      { id: "Web", label: "Web App", nodeIds: ["UI", "API"], parentId: undefined },
      { id: "Platform", label: "Platform", nodeIds: ["API", "DB"], parentId: undefined },
    ])
  })

  test("parses Mermaid subgraph-local directions", () => {
    const diagram = parseMermaidFlowchartDiagram(`
flowchart TD
  subgraph Verse
    direction LR
    A[A] --> B[B]
  end
`)

    expect(diagram.subgraphs).toEqual([
      { id: "Verse", label: "Verse", nodeIds: ["A", "B"], parentId: undefined, direction: "LR" },
    ])
  })

  test("parses and renders Mermaid subroutine nodes", () => {
    const content = `
flowchart LR
  Parse[[Parse]] --> Layout[Layout]
`
    const diagram = parseMermaidFlowchartDiagram(content)
    const output = renderFlowchartDiagram(content)

    expect(diagram.nodes[0]).toEqual({ id: "Parse", label: "Parse", shape: "subroutine" })
    expectDiagram(output).toContainInOrder("╭─┬─────┬─╮", "│ │Parse│ ├", "╰─┴─────┴─╯")
  })

  test("parses and renders Mermaid thick edges", () => {
    const content = `
flowchart LR
  Build[Build] ==> Ship[Ship]
`
    const diagram = parseMermaidFlowchartDiagram(content)
    const output = renderFlowchartDiagram(content)

    expect(diagram.edges).toEqual([{ from: "Build", to: "Ship", label: "", style: "thick" }])
    expect(output).toContain("━━━━━━▶")
  })

  test("parses and renders Mermaid dashed edges", () => {
    const content = `
flowchart LR
  Build[Build] -.-> Ship[Ship]
`
    const diagram = parseMermaidFlowchartDiagram(content)
    const output = renderFlowchartDiagram(content)

    expect(diagram.edges).toEqual([{ from: "Build", to: "Ship", label: "", style: "dashed" }])
    expect(output).toContain("──────▶")
  })

  test("paints horizontal and vertical dashed routes with solid terminal cells", () => {
    for (const direction of ["LR", "TD"] as const) {
      const content = `flowchart ${direction}\n  A -.-> B`
      const diagram = parseMermaidFlowchartDiagram(content)
      const layout = layoutParsedFlowchartDiagram(diagram)
      const grid = drawParsedFlowchartDiagramGrid(diagram)
      const route = layout.routes[0]!

      expect(route.edge.style).toBe("dashed")
      for (let index = 1; index < route.points.length; index++) {
        const from = route.points[index - 1]!
        const to = route.points[index]!
        const length = Math.abs(to.x - from.x) + Math.abs(to.y - from.y)
        for (let offset = 0; offset <= length; offset++) {
          const x = from.x + Math.sign(to.x - from.x) * offset
          const y = from.y + Math.sign(to.y - from.y) * offset
          expect(grid.getCell(x, y)?.char).not.toBe(" ")
        }
      }
    }
  })

  test("leaves shared fan-out junctions neutral", () => {
    const content = `flowchart LR
  D{driver} --> L[local]
  D --> M[Modal]
  D --> Mem[memory]`
    const diagram = parseMermaidFlowchartDiagram(content)
    const layout = layoutParsedFlowchartDiagram(diagram, { compact: true })
    const grid = drawParsedFlowchartDiagramGrid(diagram, { compact: true })
    const junction = layout.routes[0]!.points[1]!

    expect(grid.getCell(junction.x, junction.y)?.style).toBe("edge")
  })

  test("distributes short source fades before the first corner", () => {
    const content = `flowchart TD
  C[Files contract<br/>read / write / stat<br/>errors: Failed] -->|implemented by| ED[exec-defaults<br/>fused scripts<br/>one process]`
    const layout = layoutFlowchartDiagram(content)
    const grid = drawFlowchartDiagramGrid(content)
    const firstCorner = layout.routes[0]!.points[1]!
    const fadeStyles = new Set(
      grid.rows.flatMap((row) => row.map((cell) => cell.style)).filter((style) => style?.startsWith("nodeEdgeFade")),
    )

    expect(fadeStyles.has("nodeEdgeFade1")).toBe(false)
    expect(fadeStyles.has("nodeEdgeFade5")).toBe(true)
    expect(grid.getCell(firstCorner.x, firstCorner.y)?.style).toBe("edge")
  })

  test("tracks nested Mermaid subgraphs", () => {
    const diagram = parseMermaidFlowchartDiagram(`
flowchart LR
  subgraph Outer
    subgraph Inner [Inner Work]
      A[A] --> B[B]
    end
    B --> C[C]
  end
`)

    expect(diagram.subgraphs).toEqual([
      { id: "Outer", label: "Outer", nodeIds: ["B", "C"], parentId: undefined },
      { id: "Inner", label: "Inner Work", nodeIds: ["A", "B"], parentId: "Outer" },
    ])
  })

  test("detects graph headers and renders a terminal flowchart", () => {
    const output = renderFlowchartDiagram(`
graph LR
  Client([Client]) --> API[API]
  API --> Cache[(Cache)]
`)

    expectDiagram(output).toEqualDiagram(`
                                     ╭───────╮
      ╭────────╮       ╭─────╮       ├───────┤
      │ Client ├──────▶│ API ├──────▶│ Cache │
      ╰────────╯       ╰─────╯       ├───────┤
                                     ╰───────╯
    `)
  })

  test("renders Mermaid decision diamond nodes", () => {
    const output = renderFlowchartDiagram(`
flowchart LR
  Build[Build] --> Gate{Ready?}
  Gate -->|yes| Ship([Ship])
  Gate -->|no| Fix[Fix]
`)

    expect(output).toContain("Ready?")
    expect(output).toContain("╭─╯")
    expect(output).toContain("╰─╮")
    expect(output).toContain("yes")
    expect(output).toContain("no")
    expect(output).not.toMatch(/[╱╲\\/]/)
  })

  test("pads edge labels away from corners and arrowheads", () => {
    const output = renderFlowchartDiagram(`
flowchart LR
  Gate{Ready?} -->|pass| Stage[(Stage)]
  Gate -->|notes| Notes([Notes])
`)

    expect(output).toContain(" pass ")
    expect(output).toContain(" notes ")
    expect(output).not.toContain("┌pass")
    expect(output).not.toContain("└notes")
    expect(output).not.toContain("pass─▶")
    expect(output).not.toContain("notes▶")
  })

  test("renders br-delimited edge labels on separate rows", () => {
    const output = renderFlowchartDiagram(`flowchart LR
  A[Start] -->|first<br/>second line| B[Finish]`)

    expect(output).toContain("first")
    expect(output).toContain("second line")
    expect(output.indexOf("first")).toBeLessThan(output.indexOf("second line"))
    expect(output).not.toContain("<br")
  })

  test("keeps quoted multiline labels compact and renders italic node text", () => {
    const source = `flowchart TB
  DO["ServerWorkerd.create({ storage, config })"]
  DO --> SO["serverOptions()<br/><i>option flags</i>"]
  DO --> RP["replacements()<br/><i>layer overrides</i>"]
  SO -->|"fs: watcher/fff off<br/>events.persist: true<br/>mcp.stdio: false<br/>config as string"| SF["ServerFetch.make(options, { overrides })"]
  RP -->|"Database → DO-SQLite<br/>Shell/FS/Pty → typed-unavailable<br/>Snapshot/Vcs → no-op<br/>plugins → precompiled only"| SF
  SF --> GRAPH["LayerNode graph<br/>(core builds normally,<br/>swapped nodes substituted)"]`
    const grid = drawFlowchartDiagramGrid(source)
    const output = grid.toString({ trimTop: true, trimBottom: true })
    const styled = renderGridStyledText(grid, resolveFlowchartStyleColors())

    expect(Math.max(...output.split("\n").map((line) => stringWidth(line)))).toBeLessThan(140)
    expect(output).not.toMatch(/<\/?i>|<br|events persist|mcp stdio|^[^\n]*"fs:/)
    expect(
      styled.chunks.some((chunk) => chunk.text.includes("option flags") && chunk.attributes === TextAttributes.ITALIC),
    ).toBe(true)
  })

  test("keeps quoted architecture labels from distorting subgraph routes", () => {
    const source = `flowchart TB
    subgraph consumer["Durable Object"]
        DO["ServerWorkerd.create({ storage, config })"]
    end

    DO --> SO["serverOptions()<br/><i>option flags</i>"]
    DO --> RP["replacements()<br/><i>layer overrides</i>"]

    SO -->|"fs: watcher/fff off<br/>events.persist: true<br/>mcp.stdio: false<br/>config as string"| SF["ServerFetch.make(options, { overrides })"]
    RP -->|"Database → DO-SQLite<br/>Shell/FS/Pty → typed-unavailable<br/>Snapshot/Vcs → no-op<br/>plugins → precompiled only"| SF

    SF --> GRAPH["LayerNode graph<br/>(core builds normally,<br/>swapped nodes substituted)"]

    subgraph bundle["3rd mechanism: bundle conditions (build time)"]
        COND["--conditions=workerd<br/>pty / fff / photon / shell-parser<br/>native modules → inert stubs<br/>#global-roots → workerd path rooting"]
    end
    COND -.->|import resolution| GRAPH`
    const output = renderFlowchartDiagram(source)

    expect(Math.max(...output.split("\n").map((line) => stringWidth(line)))).toBeLessThan(130)
    expect(output).not.toMatch(/<\/?i>|<br|^[^\n]*"(?:fs:|Database)/)
    for (const label of [
      "fs: watcher/fff off",
      "events.persist: true",
      "mcp.stdio: false",
      "config as string",
      "Database → DO-SQLite",
      "Shell/FS/Pty → typed-unavailable",
      "Snapshot/Vcs → no-op",
      "plugins → precompiled only",
    ]) {
      expect(output).toContain(label)
    }
  })

  test("keeps tall multiline branch labels out of sibling nodes", () => {
    const output = renderFlowchartDiagram(`flowchart LR
  A[Start] -->|one<br/>two<br/>three<br/>four<br/>five| B[Upper]
  A --> C[Lower]`)
    const lines = output.split("\n")
    const labelRows = ["one", "two", "three", "four", "five"].map((line) =>
      lines.findIndex((row) => row.includes(line)),
    )
    const lowerRow = lines.findIndex((line) => line.includes("Lower"))

    expect(labelRows).toEqual([...labelRows].sort((left, right) => left - right))
    expect(lowerRow).toBeGreaterThan(labelRows.at(-1)!)
  })

  test("keeps multiline vertical edge labels above their target node", () => {
    const output = renderFlowchartDiagram(`flowchart TD
  A[Start] -->|first<br/>second<br/>third<br/>fourth| B[Finish]`)
    const lines = output.split("\n")
    const fourthRow = lines.findIndex((line) => line.includes("fourth"))
    const finishRow = lines.findIndex((line) => line.includes("Finish"))

    expect(fourthRow).toBeGreaterThanOrEqual(0)
    expect(finishRow).toBeGreaterThan(fourthRow)
    expect(output).not.toContain("<br")
  })

  test("expands canvas for multiline back-edge labels", () => {
    const output = renderFlowchartDiagram(`flowchart TD
  A --> B
  B -->|try<br/>again| A`)

    expect(output).toContain("try")
    expect(output).toContain("again")
    expect(output).not.toContain("<br")
  })

  test("only expands horizontal rank gaps for labeled edges", () => {
    const { bounds } = layoutFlowchartDiagram(`
flowchart LR
  Spec[Spec] --> Plan[Plan]
  Plan --> Build[Build]
  Build --> Gate{Ready?}
  Gate -->|pass| Stage[(Stage)]
`)
    const gapBetween = (fromId: string, toId: string): number => {
      const from = bounds.get(fromId)!
      const to = bounds.get(toId)!
      return to.left - (from.left + from.width)
    }

    expect(gapBetween("Spec", "Plan")).toBe(DEFAULT_MIN_RANK_GAP)
    expect(gapBetween("Plan", "Build")).toBe(DEFAULT_MIN_RANK_GAP)
    expect(gapBetween("Build", "Gate")).toBe(DEFAULT_MIN_RANK_GAP)
    expect(gapBetween("Gate", "Stage")).toBeGreaterThan(DEFAULT_MIN_RANK_GAP)
  })

  test("renders Mermaid subgraph frames", () => {
    const output = renderFlowchartDiagram(`
graph LR
  subgraph Web [Web App]
    UI[UI] --> API[API]
  end
  API --> DB[(DB)]
`)

    expect(output).toContain("Web App")
    expect(output).toContain("UI")
    expect(output).toContain("API")
    expect(output).toContain("DB")
    expect(output).toContain("╭─ Web App ")
    expect(output.split("\n").find((line) => line.includes("API") && line.includes("DB"))).toContain("┼")
  })

  test("merges horizontal routes through vertical subgraph borders", () => {
    const content = `flowchart LR
  Outside[Outside] --> Inside
  subgraph Group
    Inside[Inside]
  end`
    const diagram = parseMermaidFlowchartDiagram(content)
    const layout = layoutParsedFlowchartDiagram(diagram)
    const grid = drawParsedFlowchartDiagramGrid(diagram)
    const group = layout.subgraphBounds.get("Group")!
    const crossing = { x: group.left, y: layout.routes[0]!.points.at(-1)!.y }

    expect(grid.getCell(crossing.x, crossing.y)?.char).toBe("┼")
    expect(grid.getCell(crossing.x - 1, crossing.y)?.char).toBe("─")
    expect(grid.getCell(crossing.x, crossing.y - 1)?.char).toBe("│")
    expect(grid.getCell(crossing.x, crossing.y + 1)?.char).toBe("│")
  })

  test("merges vertical routes through horizontal subgraph borders", () => {
    const content = `flowchart TD
  Outside[Outside] --> Inside
  subgraph Outer [O]
    subgraph Inner
      Inside[Inside]
    end
  end`
    const diagram = parseMermaidFlowchartDiagram(content)
    const layout = layoutParsedFlowchartDiagram(diagram)
    const grid = drawParsedFlowchartDiagramGrid(diagram)
    const outer = layout.subgraphBounds.get("Outer")!
    const crossing = { x: layout.routes[0]!.points[0]!.x, y: outer.top }

    expect(grid.getCell(crossing.x, crossing.y)?.char).toBe("┼")
    expect(grid.getCell(crossing.x - 1, crossing.y)?.char).toBe("─")
    expect(grid.getCell(crossing.x + 1, crossing.y)?.char).toBe("─")
    expect(grid.getCell(crossing.x, crossing.y - 1)?.char).toBe("│")
  })

  test("reserves frame rows for br-delimited subgraph labels", () => {
    const output = renderFlowchartDiagram(`flowchart LR
  subgraph Web [API<br/>Services]
    A[Worker]
  end`)
    const lines = output.split("\n")
    const apiRow = lines.findIndex((line) => line.includes("API"))
    const servicesRow = lines.findIndex((line) => line.includes("Services"))
    const workerRow = lines.findIndex((line) => line.includes("Worker"))

    expect(apiRow).toBeGreaterThanOrEqual(0)
    expect(servicesRow).toBe(apiRow + 1)
    expect(workerRow).toBeGreaterThan(servicesRow)
    expect(output).not.toContain("<br")
  })

  test("moves multiline subgraph labels away from entering routes", () => {
    const output = renderFlowchartDiagram(`flowchart TD
  Input --> A
  subgraph Group [Line one<br/>Line two]
    A[A] --> B[B]
  end`)
    const lines = output.split("\n")
    const lineOne = lines.findIndex((line) => line.includes("Line one"))
    const lineTwo = lines.findIndex((line) => line.includes("Line two"))
    const b = lines.findIndex((line) => line.includes("│ B │"))

    expect(lineOne).toBeGreaterThan(b)
    expect(lineTwo).toBe(lineOne + 1)
    expect(output).not.toContain("<br")
  })

  test("merges transition lines through subgraph frame borders", () => {
    const output = renderFlowchartDiagram(`
flowchart TD
  subgraph Verse [verse]
    direction LR
    A[A] --> B[B]
    C[C] --> D[D]
  end
  B --> Join
  D --> Join
`)
    const crossingLines = output.split("\n").filter((line) => line.includes("Join") || line.includes("├"))

    expect(output).toContain(" verse ")
    expect(crossingLines.join("\n").match(/┼/g)).toHaveLength(2)
  })

  test("lays out subgraph-local directions independently from the outer flow", () => {
    const layout = layoutFlowchartDiagram(`
flowchart TD
  Start[Start] --> A[A]
  subgraph Steps
    direction LR
    A --> B[B]
    B --> C[C]
  end
  C --> Done[Done]
`)
    const a = layout.bounds.get("A")!
    const b = layout.bounds.get("B")!
    const c = layout.bounds.get("C")!
    const done = layout.bounds.get("Done")!
    const route = layout.routes.find((candidate) => candidate.edge.from === "A" && candidate.edge.to === "B")!

    expect(a.centerY).toBe(b.centerY)
    expect(b.left).toBeGreaterThan(a.left)
    expect(c.left).toBeGreaterThan(b.left)
    expect(done.top).toBeGreaterThan(c.top)
    expect(route.points[0]!.y).toBe(route.points[route.points.length - 1]!.y)
  })

  test("routes cross-subgraph edges around local-direction siblings", () => {
    const layout = layoutFlowchartDiagram(`flowchart TD
  subgraph Workers
    direction TD
    A[Worker one] --> B[Worker two]
  end
  subgraph Peer
    direction RL
    C[Store] --> D[Transform]
  end
  B --> D`)
    const route = layout.routes.find((candidate) => candidate.edge.from === "B" && candidate.edge.to === "D")!

    expect(routeIntersectsBounds(route, layout.bounds.get("C")!)).toBe(false)
  })

  test.each([
    ["BT", { compact: true }],
    ["LR", { compact: true }],
    ["RL", { compact: true }],
  ] as const)("keeps labeled cross-group routes clear of sibling nodes in %s layouts", (direction, options) => {
    const content = `flowchart ${direction}
  subgraph Left
    direction RL
    A[API] --> B[Queue]
  end
  subgraph Right
    direction TB
    C[Transform] --> D[Accept]
  end
  B -->|cross group| C
  D -->|retry group| A`
    const layout = layoutFlowchartDiagram(content, options)
    const crossGroup = layout.routes.find((route) => route.edge.from === "B" && route.edge.to === "C")!

    if (direction !== "LR") expect(routeIntersectsBounds(crossGroup, layout.bounds.get("A")!)).toBe(false)
    expect(renderFlowchartDiagram(content, options)).toContain("cross group")
    expect(renderFlowchartDiagram(content, options)).toContain("retry group")
  })

  test.each(["LR", "RL"] as const)(
    "keeps nested result labels and target-facing entry routes in %s layouts",
    (direction) => {
      const content = `flowchart ${direction}
  I[Input] --> A
  subgraph Outer
    direction LR
    subgraph Inner
      direction BT
      A[Parse] --> B[Valid]
      B --> C[Cache]
      C --> B
    end
    B --> D[Dispatch]
  end
  D -->|result path| O[Output]`
      const layout = layoutFlowchartDiagram(content)
      const entry = layout.routes.find((route) => route.edge.from === "I" && route.edge.to === "A")!

      expect(renderFlowchartDiagram(content)).toContain("result path")
      expect(terminalPointsTowardBounds(entry, layout.bounds.get("A")!)).toBe(true)
    },
  )

  test("keeps labels on nested routes that pass translated outer siblings", () => {
    const output = renderFlowchartDiagram(`flowchart TD
  Input --> Parse
  subgraph Outer
    direction LR
    subgraph Inner
      direction BT
      Parse[Parse] --> Validate{Valid?}
      Validate -->|yes| Cache[(Cache)]
      Cache --> Validate
    end
    Validate --> Dispatch[Dispatch]
  end`)

    expect(output).toContain("yes")
  })

  test("routes nested RL local edges around outer siblings", () => {
    const layout = layoutFlowchartDiagram(
      `flowchart RL
  I([Input λ]) --> A
  subgraph Outer [Outer group 長い]
    direction LR
    subgraph Inner [Inner<br/>工程]
      direction BT
      A[Parse request] -->|inner edge| B{Valid?}
      B --> C[(Cache Ω)]
      C --> B
    end
    B --> D[[Dispatch work]]
  end
  D -.->|result path| O([Output μ])`,
      { compact: true },
    )

    for (const route of layout.routes.filter((route) => ["A", "B", "C"].includes(route.edge.from))) {
      if (route.edge.to === "D") continue
      expect(routeIntersectsBounds(route, layout.bounds.get("D")!)).toBe(false)
    }
  })

  test("compacts stacked subgraph-local direction rows", () => {
    const layout = layoutFlowchartDiagram(`
flowchart TD
  Start[Start] --> A
  subgraph First [first row]
    direction LR
    A[A] --> B[B]
  end
  B --> C
  subgraph Second [second row]
    direction LR
    C[C] --> D[D]
  end
  D --> Done[Done]
`)
    const first = layout.subgraphBounds.get("First")!
    const second = layout.subgraphBounds.get("Second")!
    const betweenRows = layout.routes.find((route) => route.edge.from === "B" && route.edge.to === "C")!

    expect(second.top).toBeGreaterThan(first.top)
    expect(second.top - (first.top + first.height)).toBeLessThanOrEqual(DEFAULT_MIN_VERTICAL_RANK_GAP)
    expect(routeRunsAlongHorizontalBorder(betweenRows, first)).toBe(false)
    expect(routeRunsAlongHorizontalBorder(betweenRows, second)).toBe(false)
  })

  test("keeps subgraph labels readable when routes enter through the frame", () => {
    const output = renderFlowchartDiagram(`
flowchart TD
  Start[Start] --> Remember
  subgraph Remembering [remember to]
    direction LR
    Remember[remember to] --> Heart[Heart]
  end
`)

    expect(output).toContain(" remember to ")
    expect(output).not.toContain("rememb▼r")
  })

  test("keeps local LR branch joins compact when they feed a vertical stage", () => {
    const content = `
flowchart TD
  Start[Start] --> A
  subgraph Verse [verse]
    direction LR
    A[A]
    B[B]
    C[C]
    D[D]
    E[E]
    F[F]
    G[G]
    A --> B
    B --> C
    A --> D
    D --> E
    A --> F
    F --> G
  end
  C --> Join
  E --> Join
  G --> Join
`
    const layout = layoutFlowchartDiagram(content)
    const b = layout.bounds.get("B")!
    const c = layout.bounds.get("C")!
    const d = layout.bounds.get("D")!
    const e = layout.bounds.get("E")!
    const verse = layout.subgraphBounds.get("Verse")!
    const joinRoutes = layout.routes.filter((route) => route.edge.to === "Join")
    const output = renderFlowchartDiagram(content)

    expect(c.left).toBeGreaterThan(b.left)
    expect(e.left).toBeGreaterThan(d.left)
    expect(new Set(joinRoutes.map((route) => route.points[1]!.x)).size).toBe(1)
    expect(Math.max(...joinRoutes.flatMap((route) => route.points.map((point) => point.x)))).toBeGreaterThan(
      verse.left + verse.width,
    )
    expect(output).not.toContain("││")
  })

  test("routes transitions between local LR subgraphs outside their frames", () => {
    const layout = layoutFlowchartDiagram(`
flowchart TD
  subgraph First [first]
    direction LR
    A[A]
    B[B]
    C[C]
    A --> B
    A --> C
  end
  B --> D
  C --> D
  subgraph Second [second]
    direction LR
    D[D] --> E[E]
  end
`)
    const first = layout.subgraphBounds.get("First")!
    const second = layout.subgraphBounds.get("Second")!
    const routes = layout.routes.filter((route) => route.edge.to === "D")

    expect(routes.length).toBe(2)
    for (const route of routes) {
      expect(routeRunsAlongHorizontalBorder(route, first)).toBe(false)
      expect(routeRunsAlongVerticalBorder(route, first)).toBe(false)
      expect(routeRunsAlongHorizontalBorder(route, second)).toBe(false)
      expect(routeRunsAlongVerticalBorder(route, second)).toBe(false)
    }
  })

  test("keeps grouped fan routes orthogonal after subgraph translation", () => {
    const layout = layoutFlowchartDiagram(`
flowchart LR
  Brief([Sketch Brief]) --> Parse[Parse Mermaid]
  subgraph Plan [Diagram Plan]
    Parse --> Layout[Rank Layout]
    Parse --> Cache[(Diagram Cache)]
  end
  Layout --> Preview([Terminal Preview])
  Cache --> Preview
`)

    for (const route of layout.routes) {
      for (let index = 1; index < route.points.length; index++) {
        const from = route.points[index - 1]!
        const to = route.points[index]!
        expect(from.x === to.x || from.y === to.y).toBe(true)
      }
    }
  })

  test("separates cross-dependent top-level subgraphs", () => {
    const content = `flowchart TD
  subgraph plugins["Plugins — one verb: attach"]
    chip["pr-indicator<br/>attach(prompt.footer, { after: 'directory' })"]
    theme["fancy-footer<br/>attach(prompt.footer, { replace: 'right' })"]
  end

  subgraph host["Host anatomy tree — published, stable part IDs"]
    footer["prompt.footer"]
    left["left"]
    right["right<br/>(container)"]
    dir["directory"]
    model["model"]
    tokens["tokens"]
    footer --> left
    footer --> right
    right --> dir
    right --> model
    right --> tokens
  end

  chip -- "insert after" --> dir
  theme == "takeover" ==> right
  theme -. "suppresses guests<br/>in subtree" .-> chip`
    const layout = layoutFlowchartDiagram(content)
    const plugins = layout.subgraphBounds.get("plugins")!
    const host = layout.subgraphBounds.get("host")!
    const output = renderFlowchartDiagram(content)
    const lines = output.split("\n")

    expect(host.top).toBeGreaterThanOrEqual(plugins.top + plugins.height)
    expect(lines.filter((line) => line.includes("Plugins — one verb: attach"))).toHaveLength(1)
    expect(lines.filter((line) => line.includes("Host anatomy tree — published, stable part IDs"))).toHaveLength(1)
    expect(lines.findIndex((line) => line.includes("Host anatomy tree"))).toBeGreaterThan(
      lines.findIndex((line) => line.includes("Plugins — one verb")),
    )
    for (const route of layout.routes) {
      for (let index = 1; index < route.points.length; index++) {
        const from = route.points[index - 1]!
        const to = route.points[index]!
        expect(from.x === to.x || from.y === to.y).toBe(true)
      }
    }
  })

  test.each(["TD", "BT", "LR", "RL"] as const)(
    "keeps parallel top-level subgraphs in the same rank for %s diagrams",
    (direction) => {
      const layout = layoutFlowchartDiagram(`flowchart ${direction}
  subgraph source [Source]
    A[A]
  end
  subgraph left [Left]
    B[B]
  end
  subgraph right [Right]
    C[C]
  end
  A --> B
  A --> C`)
      const source = layout.subgraphBounds.get("source")!
      const left = layout.subgraphBounds.get("left")!
      const right = layout.subgraphBounds.get("right")!
      const leftNode = layout.bounds.get("B")!
      const rightNode = layout.bounds.get("C")!
      const horizontal = direction === "LR" || direction === "RL"
      const reversed = direction === "BT" || direction === "RL"
      const start = (bound: typeof source) => {
        const value = horizontal ? bound.left : bound.top
        const size = horizontal ? bound.width : bound.height
        return reversed ? -(value + size) : value
      }
      const size = (bound: typeof source) => (horizontal ? bound.width : bound.height)

      expect(horizontal ? leftNode.centerX : leftNode.centerY).toBe(horizontal ? rightNode.centerX : rightNode.centerY)
      expect(Math.min(start(left), start(right))).toBeGreaterThanOrEqual(start(source) + size(source))
    },
  )

  test.each(["TD", "BT", "LR", "RL"] as const)(
    "separates oversized parallel subgraph labels across %s diagrams",
    (direction) => {
      const horizontal = direction === "LR" || direction === "RL"
      const label = horizontal
        ? "one<br/>two<br/>three<br/>four<br/>five"
        : "A very very wide downstream subgraph title"
      const layout = layoutFlowchartDiagram(`flowchart ${direction}
  subgraph source [Source]
    A[A]
  end
  subgraph left [${label}]
    B[B]
  end
  subgraph right [Right]
    C[C]
  end
  A --> B
  A --> C`)
      const left = layout.subgraphBounds.get("left")!
      const right = layout.subgraphBounds.get("right")!
      const overlap =
        left.left < right.left + right.width &&
        left.left + left.width > right.left &&
        left.top < right.top + right.height &&
        left.top + left.height > right.top

      expect(overlap).toBe(false)
    },
  )

  test.each(["TD", "BT", "LR", "RL"] as const)(
    "ranks nested order-only subgraph dependencies for %s diagrams",
    (direction) => {
      const layout = layoutFlowchartDiagram(`flowchart ${direction}
  subgraph first [First]
    subgraph firstInner [First inner]
      A[A]
    end
  end
  subgraph second [Second]
    subgraph secondInner [Second inner]
      B[B]
    end
  end
  firstInner ~~~ secondInner`)
      const first = layout.subgraphBounds.get("first")!
      const second = layout.subgraphBounds.get("second")!
      const horizontal = direction === "LR" || direction === "RL"
      const reversed = direction === "BT" || direction === "RL"
      const start = (bound: typeof first) => {
        const value = horizontal ? bound.left : bound.top
        const size = horizontal ? bound.width : bound.height
        return reversed ? -(value + size) : value
      }
      const size = horizontal ? first.width : first.height

      expect(start(second)).toBeGreaterThanOrEqual(start(first) + size)
    },
  )

  test.each(["TD", "BT", "LR", "RL"] as const)(
    "ranks cyclic top-level subgraphs as one downstream component for %s diagrams",
    (direction) => {
      const layout = layoutFlowchartDiagram(`flowchart ${direction}
  subgraph source [Source]
    A[A]
  end
  subgraph first [First]
    B[B]
  end
  subgraph second [Second]
    C[C]
  end
  A --> B
  B --> C
  C --> B`)
      const source = layout.subgraphBounds.get("source")!
      const first = layout.subgraphBounds.get("first")!
      const second = layout.subgraphBounds.get("second")!
      const horizontal = direction === "LR" || direction === "RL"
      const reversed = direction === "BT" || direction === "RL"
      const start = (bound: typeof source) => {
        const value = horizontal ? bound.left : bound.top
        const size = horizontal ? bound.width : bound.height
        return reversed ? -(value + size) : value
      }
      const size = (bound: typeof source) => (horizontal ? bound.width : bound.height)

      expect(Math.min(start(first), start(second))).toBeGreaterThanOrEqual(start(source) + size(source))
    },
  )

  test("moves subgraph labels away from crossing routes", () => {
    const output = renderFlowchartDiagram(`
flowchart TD
  Payment -->|approved| Orders[(Orders DB)]
  Payment -->|declined| Retry([Retry])
  Orders --> Receipt([Receipt])
  subgraph Fulfill [Fulfillment]
    Orders[(Orders DB)]
    Receipt([Receipt])
  end
`)
    const lines = output.split("\n")
    const titleLineIndex = lines.findIndex((line) => line.includes("Fulfillment"))
    const ordersLineIndex = lines.findIndex((line) => line.includes("Orders DB"))

    expect(titleLineIndex).toBeGreaterThan(ordersLineIndex)
    expect(lines[titleLineIndex]).not.toContain("approved")
  })

  test("renders labeled vertical branches", () => {
    const output = renderFlowchartDiagram(`
flowchart TD
  Input([Input]) --> Router[Route]
  Router -->|hit| Cache[(Cache)]
  Router -->|miss| Worker[Worker]
`)

    expect(output).toContain("Input")
    expect(output).toContain("Route")
    expect(output).toContain("Cache")
    expect(output).toContain("Worker")
    expect(output).toContain("hit")
    expect(output).toContain("miss")
    expect(output).toContain("▼")
  })

  test("routes branch edges without diagonal glyphs", () => {
    const output = renderFlowchartDiagram(`
graph LR
  Ticket([Ticket]) --> Triage[Auto Triage]
  Triage -->|billing| Billing[Billing Queue]
  Triage -->|bug| Bugs[(Bug Tracker)]
  Triage -->|question| Docs[Docs Reply]
  Billing --> Done([Closed])
  Bugs --> Done
  Docs --> Done
`)

    expect(output).toContain("Billing Queue")
    expect(output).toContain("Bug Tracker")
    expect(output).toContain("Docs Reply")
    expect(output).toContain("┼")
    expect(output).not.toMatch(/[▲▼]│/)
    expect(output).not.toMatch(/[╱╲\\/]/)
  })

  test("keeps vertical branch labels separated from return edges", () => {
    const output = renderFlowchartDiagram(`
flowchart TD
  Cart([Cart]) --> Address[Address]
  Address --> Payment[Payment]
  Payment -->|approved| Orders[(Orders DB)]
  Payment -->|declined| Retry([Retry])
  Retry --> Payment
  Orders --> Receipt([Receipt])
`)

    expect(output).toContain("approved")
    expect(output).toContain("declined")
    expect(output).not.toContain("approveddeclined")
    expect(output).not.toContain("declinedapproved")
  })

  test("expands canvas to include back-edge labels", () => {
    const output = renderFlowchartDiagram(`
flowchart TD
  A --> B
  B -->|again| A
`)

    expect(output).toContain("again")
  })

  test("keeps vertical flowcharts compact with attached source connectors", () => {
    const output = renderFlowchartDiagram(`
flowchart TD
  Cart([Cart]) --> Address[Address]
  Address --> Payment[Payment]
  Payment -->|approved| Orders[(Orders DB)]
  Payment -->|declined| Retry([Retry])
  Retry --> Payment
  Orders --> Receipt([Receipt])
`)
    const lines = output.split("\n")
    const cartConnectorLineIndex = lines.findIndex((line) => line.includes("┬"))
    const connectorColumn = [...lines[cartConnectorLineIndex]!].indexOf("┬")

    expect(lines.length).toBeLessThanOrEqual(34)
    expect([...lines[cartConnectorLineIndex + 1]!][connectorColumn]).toBe("│")
  })

  test("keeps short back-edge labels out of source nodes", () => {
    const output = renderFlowchartDiagram(`
flowchart LR
  Build[Build Services] --> Test[Integration Tests]
  Test -->|pass| Canary[Canary]
  Test -->|fail| Fix[Fix Forward]
  Fix --> Build
  Canary -->|rollback| Fix
`)
    const rollbackLine = output.split("\n").find((line) => line.includes("rollback"))

    expect(rollbackLine).toBeDefined()
    expect(rollbackLine).not.toContain("Canary")
    expect(rollbackLine).not.toContain("Fix Forward")
  })

  test("applies the global flowchart StyledText theme", () => {
    const grid = drawFlowchartDiagramGrid("flowchart LR\n  A[Alpha] --> B[Beta]")
    const node = parseColor("#ff0000")
    const styled = renderGridStyledText(grid, resolveFlowchartStyleColors({ node }))

    expect(styled.chunks.some((chunk) => chunk.text.includes("Alpha") && chunk.fg?.equals(node))).toBe(true)
  })
})
