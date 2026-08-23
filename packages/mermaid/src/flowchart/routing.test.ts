import { describe, expect, test } from "bun:test"
import { diagramTextWidth } from "../core/text.js"
import { flowchartEdgeLabelLayout } from "./labels.js"
import type { FlowchartDiagram, FlowchartNodeBounds } from "./types.js"
import { routeFlowchartEdges } from "./routing.js"

function bounds(id: string, left: number, top: number): FlowchartNodeBounds {
  const width = 5
  const height = 3
  return {
    id,
    width,
    height,
    lines: [id],
    left,
    top,
    centerX: left + Math.floor(width / 2),
    centerY: top + Math.floor(height / 2),
  }
}

function diagram(direction: FlowchartDiagram["direction"], edges: FlowchartDiagram["edges"]): FlowchartDiagram {
  return { direction, nodes: [], edges, subgraphs: [] }
}

function routeIntersectsBounds(
  points: readonly { x: number; y: number }[],
  nodeBounds: { left: number; top: number; width: number; height: number },
): boolean {
  const right = nodeBounds.left + nodeBounds.width - 1
  const bottom = nodeBounds.top + nodeBounds.height - 1
  return points.slice(1).some((to, index) => {
    const from = points[index]!
    if (from.x === to.x) {
      return (
        from.x >= nodeBounds.left &&
        from.x <= right &&
        Math.max(from.y, to.y) >= nodeBounds.top &&
        Math.min(from.y, to.y) <= bottom
      )
    }
    return (
      from.y >= nodeBounds.top &&
      from.y <= bottom &&
      Math.max(from.x, to.x) >= nodeBounds.left &&
      Math.min(from.x, to.x) <= right
    )
  })
}

describe("flowchart routing", () => {
  test("routes a simple horizontal edge from source port to target port", () => {
    const edge = { from: "A", to: "B", label: "" }
    const routes = routeFlowchartEdges(
      diagram("LR", [edge]),
      new Map([
        ["A", bounds("A", 0, 0)],
        ["B", bounds("B", 20, 0)],
      ]),
    )

    expect(routes).toEqual([
      {
        edge,
        points: [
          { x: 5, y: 1 },
          { x: 19, y: 1 },
        ],
      },
    ])
  })

  test("routes a simple reverse horizontal edge into the target right port", () => {
    const edge = { from: "A", to: "B", label: "" }
    const routes = routeFlowchartEdges(
      diagram("RL", [edge]),
      new Map([
        ["A", bounds("A", 20, 0)],
        ["B", bounds("B", 0, 0)],
      ]),
    )

    expect(routes).toEqual([
      {
        edge,
        points: [
          { x: 19, y: 1 },
          { x: 5, y: 1 },
        ],
      },
    ])
  })

  test("routes horizontal back-edges above forward lanes", () => {
    const edge = { from: "B", to: "A", label: "" }
    const routes = routeFlowchartEdges(
      diagram("LR", [edge]),
      new Map([
        ["A", bounds("A", 0, 0)],
        ["B", bounds("B", 20, 0)],
      ]),
    )

    expect(routes).toEqual([
      {
        edge,
        points: [
          { x: 22, y: -1 },
          { x: 22, y: -4 },
          { x: 2, y: -4 },
          { x: 2, y: -1 },
        ],
      },
    ])
  })

  test("routes parallel horizontal edges on independent lanes", () => {
    const edges = [
      { from: "A", to: "B", label: "first" },
      { from: "A", to: "B", label: "second" },
    ]
    const routes = routeFlowchartEdges(
      diagram("LR", edges),
      new Map([
        ["A", bounds("A", 0, 0)],
        ["B", bounds("B", 20, 0)],
      ]),
    )

    expect(routes.map((route) => route.points)).toEqual([
      [
        { x: 5, y: 1 },
        { x: 19, y: 1 },
      ],
      [
        { x: 2, y: 3 },
        { x: 2, y: 6 },
        { x: 22, y: 6 },
        { x: 22, y: 3 },
      ],
    ])
  })

  test("spaces parallel horizontal lanes for multiline labels", () => {
    const edges = [
      { from: "A", to: "B", label: "first" },
      { from: "A", to: "B", label: "second 1<br/>second 2<br/>second 3" },
      { from: "A", to: "B", label: "third 1<br/>third 2<br/>third 3" },
    ]
    const routes = routeFlowchartEdges(
      diagram("LR", edges),
      new Map([
        ["A", bounds("A", 0, 0)],
        ["B", bounds("B", 20, 0)],
      ]),
    )

    expect(routes[2]!.points[1]!.y).toBeGreaterThan(routes[1]!.points[1]!.y + 3)
  })

  test("routes horizontal fan-out through a shared bus lane", () => {
    const edges = [
      { from: "A", to: "B", label: "" },
      { from: "A", to: "C", label: "" },
    ]
    const routes = routeFlowchartEdges(
      diagram("LR", edges),
      new Map([
        ["A", bounds("A", 0, 6)],
        ["B", bounds("B", 20, 0)],
        ["C", bounds("C", 20, 12)],
      ]),
    )

    expect(routes.map((route) => route.points)).toEqual([
      [
        { x: 5, y: 7 },
        { x: 8, y: 7 },
        { x: 8, y: 1 },
        { x: 19, y: 1 },
      ],
      [
        { x: 5, y: 7 },
        { x: 8, y: 7 },
        { x: 8, y: 13 },
        { x: 19, y: 13 },
      ],
    ])
  })

  test("routes each horizontal edge once when fan-in and fan-out overlap", () => {
    const edges = [
      { from: "A", to: "C", label: "" },
      { from: "A", to: "D", label: "" },
      { from: "B", to: "C", label: "" },
      { from: "B", to: "D", label: "" },
    ]
    const routes = routeFlowchartEdges(
      diagram("LR", edges),
      new Map([
        ["A", bounds("A", 0, 0)],
        ["B", bounds("B", 0, 12)],
        ["C", bounds("C", 24, 0)],
        ["D", bounds("D", 24, 12)],
      ]),
    )

    expect(routes).toHaveLength(edges.length)
    expect(routes.map((route) => `${route.edge.from}->${route.edge.to}`).sort()).toEqual([
      "A->C",
      "A->D",
      "B->C",
      "B->D",
    ])
  })

  test("routes vertical back-edges around the left side", () => {
    const edge = { from: "B", to: "A", label: "" }
    const routes = routeFlowchartEdges(
      diagram("TD", [edge]),
      new Map([
        ["A", bounds("A", 0, 0)],
        ["B", bounds("B", 0, 12)],
      ]),
    )

    expect(routes).toEqual([
      {
        edge,
        points: [
          { x: -1, y: 13 },
          { x: -4, y: 13 },
          { x: -4, y: 1 },
          { x: -1, y: 1 },
        ],
      },
    ])
  })

  test("routes self edges below the source node", () => {
    const edge = { from: "A", to: "A", label: "" }
    const routes = routeFlowchartEdges(diagram("TD", [edge]), new Map([["A", bounds("A", 0, 0)]]))

    expect(routes).toEqual([
      {
        edge,
        points: [
          { x: 5, y: 1 },
          { x: 8, y: 1 },
          { x: 8, y: 4 },
          { x: 2, y: 4 },
          { x: 2, y: 3 },
        ],
      },
    ])
  })

  test("routes same-column horizontal-flow edges through vertical ports", () => {
    const edge = { from: "A", to: "B", label: "rollback" }
    const routes = routeFlowchartEdges(
      diagram("LR", [edge]),
      new Map([
        ["A", bounds("A", 20, 0)],
        ["B", bounds("B", 20, 8)],
      ]),
    )

    expect(routes).toEqual([
      {
        edge,
        points: [
          { x: 22, y: 3 },
          { x: 22, y: 7 },
        ],
      },
    ])
  })

  test("routes overlapping horizontal-flow columns through vertical ports", () => {
    const edge = { from: "A", to: "B", label: "merge" }
    const routes = routeFlowchartEdges(
      diagram("RL", [edge]),
      new Map([
        ["A", bounds("A", 1, 8)],
        ["B", bounds("B", 0, 0)],
      ]),
    )

    expect(routes).toEqual([
      {
        edge,
        points: [
          { x: 2, y: 7 },
          { x: 2, y: 3 },
        ],
      },
    ])
  })

  test("does not route a fallback through its own source node", () => {
    const labeled = { from: "A", to: "B", label: "route" }
    const crossing = { from: "C", to: "D", label: "" }
    const nodeBounds = new Map([
      ["A", bounds("A", 0, 0)],
      ["B", bounds("B", 100, 0)],
      ["C", bounds("C", 48, -12)],
      ["D", bounds("D", 48, 12)],
    ])
    const routes = routeFlowchartEdges(diagram("LR", [labeled, crossing]), nodeBounds, undefined, new Map())
    const route = routes.find((candidate) => candidate.edge === labeled)!

    expect(routeIntersectsBounds(route.points, nodeBounds.get("A")!)).toBe(false)
    expect(routeIntersectsBounds(route.points, nodeBounds.get("B")!)).toBe(false)
  })

  test("ignores zero-width blank label interiors as route obstacles", () => {
    const blankLabel = { from: "A", to: "B", label: "<br/>" }
    const crossing = { from: "C", to: "D", label: "" }
    const routes = routeFlowchartEdges(
      diagram("TD", [blankLabel, crossing]),
      new Map([
        ["A", bounds("A", 0, 0)],
        ["B", bounds("B", 0, 100)],
        ["C", bounds("C", -20, 50)],
        ["D", bounds("D", 20, 50)],
      ]),
      (edge) => (edge === blankLabel ? "TD" : "LR"),
      new Map(),
    )

    expect(routes.find((route) => route.edge === blankLabel)!.points).toEqual([
      { x: 2, y: 3 },
      { x: 2, y: 99 },
    ])
  })

  test("checks earlier labels against finalized later fallback routes", () => {
    const edges = [
      { from: "C", to: "B", label: "alpha" },
      { from: "A", to: "F", label: "beta long" },
      { from: "C", to: "D", label: "gamma" },
      { from: "A", to: "B", label: "" },
    ]
    const directions = ["TD", "RL", "LR", "BT"] as const
    const routes = routeFlowchartEdges(
      diagram("LR", edges),
      new Map([
        ["A", bounds("A", -24, 6)],
        ["B", bounds("B", 48, 24)],
        ["C", bounds("C", -24, 24)],
        ["D", bounds("D", -24, -18)],
        ["F", bounds("F", -16, -6)],
      ]),
      (edge) => directions[edges.indexOf(edge)]!,
      new Map(),
    )
    const labeled = routes.find((route) => route.edge === edges[0])!
    const laterFallback = routes.find((route) => route.edge === edges[3])!
    const label = flowchartEdgeLabelLayout(labeled.points, labeled.edge.label, diagramTextWidth)

    expect(labeled.points).toEqual([
      { x: -19, y: 25 },
      { x: 47, y: 25 },
    ])
    expect(
      routeIntersectsBounds(laterFallback.points, {
        left: label.point.x + 1,
        top: label.point.y,
        width: label.width - 2,
        height: label.height,
      }),
    ).toBe(false)
  })
})
