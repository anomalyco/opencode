import { describe, expect, test } from "bun:test"
import type { AgentGraph, AgentGraphNode } from "./model"
import { agentGraphLayout } from "./layout"

const node = (id: string, parentID?: string): AgentGraphNode => ({
  id,
  parentID,
  label: id,
  agent: undefined,
  agentName: undefined,
  agentColor: undefined,
  status: "idle",
  model: undefined,
  tokens: 0,
  cost: 0,
  description: undefined,
  started: 0,
})

const graph = (nodes: AgentGraphNode[], edges: AgentGraph["edges"]): AgentGraph => ({ rootID: nodes[0]?.id, nodes, edges })

// Parses the coordinates out of an SVG path's commands.
const numbers = (path: string) => path.match(/-?[\d.]+/g)?.map(Number) ?? []

const size = { nodeWidth: 100, nodeHeight: 40, layerGap: 20, siblingGap: 10, arcOffset: 30, padding: 8 }
const step = size.nodeWidth + size.siblingGap
const layer = size.nodeHeight + size.layerGap

describe("agentGraphLayout", () => {
  test("returns an empty layout for an empty family", () => {
    expect(agentGraphLayout(graph([], []), size)).toEqual({ nodes: [], edges: [], width: 0, height: 0 })
  })

  test("places a single root at the top-left padding corner", () => {
    const value = agentGraphLayout(graph([node("ses_root")], []), size)

    expect(value.nodes).toEqual([{ id: "ses_root", x: 8, y: 8, width: 100, height: 40, depth: 0 }])
    expect(value.width).toBe(8 + 100 + 8)
    expect(value.height).toBe(8 + 40 + 8)
  })

  test("centers a parent over its children, one layer per BFS level", () => {
    const root = node("ses_root")
    const left = node("ses_left", "ses_root")
    const right = node("ses_right", "ses_root")
    const leaf = node("ses_leaf", "ses_left")

    const value = agentGraphLayout(graph([root, left, right, leaf], []), size)
    const byID = new Map(value.nodes.map((item) => [item.id, item]))

    expect(byID.get("ses_root")).toMatchObject({ x: 8 + step * 0.5, y: 8, depth: 0 })
    expect(byID.get("ses_left")).toMatchObject({ x: 8, y: 8 + layer, depth: 1 })
    expect(byID.get("ses_right")).toMatchObject({ x: 8 + step, y: 8 + layer, depth: 1 })
    expect(byID.get("ses_leaf")).toMatchObject({ x: 8, y: 8 + layer * 2, depth: 2 })

    // Same-layer nodes never overlap: every pair in a layer is at least one slot apart.
    for (let depth = 0; depth < 3; depth++) {
      const items = value.nodes.filter((item) => item.depth === depth).map((item) => item.x)

      for (let i = 1; i < items.length; i++) expect(items[i] - items[i - 1]).toBeGreaterThanOrEqual(step)
    }
  })

  test("a deep chain descends one layer per level, aligned under its parent", () => {
    const root = node("ses_root")
    const child = node("ses_child", "ses_root")
    const grandchild = node("ses_grand", "ses_child")

    const value = agentGraphLayout(graph([root, child, grandchild], []), size)
    const byID = new Map(value.nodes.map((item) => [item.id, item]))

    expect(byID.get("ses_root")).toMatchObject({ x: 8, y: 8, depth: 0 })
    expect(byID.get("ses_child")).toMatchObject({ x: 8, y: 8 + layer, depth: 1 })
    expect(byID.get("ses_grand")).toMatchObject({ x: 8, y: 8 + layer * 2, depth: 2 })
  })

  test("a wide layer of running subagents spreads left to right without overlap", () => {
    const root = node("ses_root")
    const children = ["ses_a", "ses_b", "ses_c"].map((id) => node(id, "ses_root"))

    const value = agentGraphLayout(graph([root, ...children], []), size)
    const byID = new Map(value.nodes.map((item) => [item.id, item]))

    expect(byID.get("ses_root")).toMatchObject({ x: 8 + step, depth: 0 })
    expect(value.nodes.filter((item) => item.depth === 1).map((item) => item.x)).toEqual([8, 8 + step, 8 + step * 2])
    expect(value.width).toBe(8 + step * 2 + 100 + 8)
  })

  test("draws spawn edges as orthogonal polylines between parent bottom and child top", () => {
    const root = node("ses_root")
    const child = node("ses_child", "ses_root")

    const value = agentGraphLayout(
      graph([root, child], [{ type: "spawn", from: "ses_root", to: "ses_child", agent: undefined, label: undefined, started: undefined }]),
      size,
    )
    const [x1, y1, x2, y2, x3, y3, x4, y4] = numbers(value.edges[0].path)

    expect(value.edges[0].type).toBe("spawn")
    // Leaves the parent's bottom center, bends once in the layer gap, enters the child's top center.
    expect([x1, y1]).toEqual([8 + 50, 8 + 40])
    expect([x4, y4]).toEqual([8 + 50, 8 + layer])
    expect(x1).toBe(x2)
    expect(y2).toBe(y3)
    expect(x3).toBe(x4)
  })

  test("draws message arcs from border to border, bowed off the straight path", () => {
    const root = node("ses_root")
    const child = node("ses_child", "ses_root")

    const value = agentGraphLayout(
      graph([root, child], [
        { type: "message", from: "ses_child", to: "ses_root", kind: "report", count: 1, last: messageOf() },
      ]),
      size,
    )
    const edge = value.edges[0]

    expect(edge.type).toBe("message")
    if (edge.type !== "message") return
    expect(edge.kind).toBe("report")

    // A report travels upward: the arc leaves the child's top border and enters the parent's bottom.
    const [sx, sy, cx, , ex, ey] = numbers(edge.path)

    expect([sx, sy]).toEqual([8 + 50, 8 + layer])
    expect([ex, ey]).toEqual([8 + 50, 8 + 40])
    // The control point bows horizontally off the straight, vertical path.
    expect(cx).toBe(8 + 50 + 30)
  })

  test("parallel arcs between the same pair bow apart so both kinds stay distinguishable", () => {
    const root = node("ses_root")
    const child = node("ses_child", "ses_root")
    const edges: AgentGraph["edges"] = [
      { type: "message", from: "ses_child", to: "ses_root", kind: "report", count: 1, last: messageOf() },
      { type: "message", from: "ses_child", to: "ses_root", kind: "message", count: 1, last: messageOf() },
    ]

    const value = agentGraphLayout(graph([root, child], edges), size)
    const paths = value.edges.filter((edge) => edge.type === "message").map((edge) => edge.path)

    expect(paths).toHaveLength(2)
    expect(paths[0]).not.toBe(paths[1])
    expect(numbers(paths[1])[2]).toBe(8 + 50 + 60)
  })

  test("skips edges whose endpoints are missing from the graph", () => {
    const value = agentGraphLayout(graph([node("ses_root")], [{ type: "spawn", from: "ses_root", to: "ses_gone", agent: undefined, label: undefined, started: undefined }]), size)

    expect(value.edges).toEqual([])
  })

  test("terminates on a malformed parent cycle", () => {
    const a = node("ses_a", "ses_b")
    const b = node("ses_b", "ses_a")

    const value = agentGraphLayout(graph([a, b], []), size)

    expect(value.nodes.map((item) => item.id).sort()).toEqual(["ses_a", "ses_b"])
  })
})

function messageOf() {
  return {
    id: "msg_1",
    from: { sessionID: "ses_child" },
    to: { sessionID: "ses_root" },
    kind: "report" as const,
    body: "Done",
    time: { created: 0 },
    sequence: 0,
  }
}
