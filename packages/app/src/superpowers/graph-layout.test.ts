import { beforeEach, describe, expect, test } from "bun:test"
import { summarizeProgress, type Task } from "@bearmanser/opencode-superpowers-execution/contract"
import {
  GRAPH_GROUPING_THRESHOLD,
  GRAPH_MAX_ZOOM,
  GRAPH_MIN_ZOOM,
  GRAPH_NODE_HEIGHT,
  GRAPH_NODE_WIDTH,
  GRAPH_VERTICAL_GAP,
  cachedLayout,
  clampZoom,
  graphSignature,
  groupTasksByPhase,
  layoutTaskGraph,
  resetLayoutCache,
  type GraphLayout,
  type GraphMeasurer,
} from "./graph-layout"
import { taskFixture, taskGraphFixture } from "./fixtures"

beforeEach(() => resetLayoutCache())

function nodesByY(layout: GraphLayout) {
  return [...layout.nodes].sort((left, right) => left.y - right.y).map((node) => node.id)
}

function nodeByID(layout: GraphLayout, id: string) {
  const node = layout.nodes.find((candidate) => candidate.id === id)
  if (!node) throw new Error(`missing node ${id}`)
  return node
}

describe("layoutTaskGraph", () => {
  test("status-only updates do not move task nodes", () => {
    const tasks = taskGraphFixture()
    const first = layoutTaskGraph(tasks)
    const changed = layoutTaskGraph(tasks.map((task) => ({ ...task, state: "running" })))
    expect(changed.nodes).toEqual(first.nodes)
    expect(first.edges.some((edge) => edge.from === "schema" && edge.to === "api")).toBe(true)
  })

  test("lays out the diamond dag by dependency layer with boundary edges", () => {
    const layout = layoutTaskGraph(taskGraphFixture())
    const schema = nodeByID(layout, "schema")
    const api = nodeByID(layout, "api")
    const cli = nodeByID(layout, "cli")
    const tests = nodeByID(layout, "tests")
    const finalReview = nodeByID(layout, "final-review")

    expect(schema.x).toBe(0)
    expect(api.x).toBe(GRAPH_NODE_WIDTH + 72)
    expect(cli.x).toBe(api.x)
    expect(tests.x).toBe(api.x * 2)
    expect(finalReview.x).toBe(api.x * 3)
    expect(api.y).toBeLessThan(cli.y)
    expect(layout.width).toBe(finalReview.x + GRAPH_NODE_WIDTH)

    const edges: string[] = layout.edges.map((edge) => `${edge.from}->${edge.to}`)
    expect(edges).toEqual(["schema->api", "schema->cli", "api->tests", "cli->tests", "tests->final-review"])

    const schemaEdge = layout.edges.find((edge) => edge.from === "schema" && edge.to === "api")
    expect(schemaEdge?.path).toContain(`M ${schema.x + schema.width} ${schema.y + schema.height / 2}`)
    expect(schemaEdge?.path).toContain(String(api.x))
  })

  test("orders each layer by declared order and then id", () => {
    const layout = layoutTaskGraph([
      taskFixture({ id: "c", order: 2 }),
      taskFixture({ id: "b", order: 1 }),
      taskFixture({ id: "b2", order: 1 }),
      taskFixture({ id: "a", order: 0 }),
    ])
    expect(nodesByY(layout)).toEqual(["a", "b", "b2", "c"])
    expect(layout.edges).toEqual([])
  })

  test("keeps disconnected nodes in the first layer", () => {
    const layout = layoutTaskGraph([
      taskFixture({ id: "one", order: 3 }),
      taskFixture({ id: "two", order: 1 }),
      taskFixture({ id: "three", order: 2 }),
    ])
    expect(layout.nodes).toHaveLength(3)
    expect(layout.nodes.every((node) => node.x === 0 && node.width === GRAPH_NODE_WIDTH)).toBe(true)
    expect(nodesByY(layout)).toEqual(["two", "three", "one"])
    expect(layout.edges).toEqual([])
    expect(layout.height).toBe(3 * GRAPH_NODE_HEIGHT + 2 * GRAPH_VERTICAL_GAP)
  })

  test("breaks equal-order ties deterministically by id", () => {
    const tasks = [
      taskFixture({ id: "delta", order: 4 }),
      taskFixture({ id: "alpha", order: 4 }),
      taskFixture({ id: "charlie", order: 4 }),
      taskFixture({ id: "bravo", order: 4 }),
    ]
    expect(nodesByY(layoutTaskGraph(tasks))).toEqual(["alpha", "bravo", "charlie", "delta"])
    expect(nodesByY(layoutTaskGraph([...tasks].reverse()))).toEqual(["alpha", "bravo", "charlie", "delta"])
  })

  test("lays out the accepted 500-task graph without duplicate positions", () => {
    const tasks = Array.from({ length: 500 }, (_, index) =>
      taskFixture({ id: `task-${String(index).padStart(3, "0")}`, order: index }),
    )
    const layout = layoutTaskGraph(tasks)
    expect(layout.nodes).toHaveLength(500)
    expect(new Set(layout.nodes.map((node) => `${node.x}:${node.y}`)).size).toBe(500)
    expect(layout.width).toBe(GRAPH_NODE_WIDTH)
  })

  test("records the 500-task layout and status-update budgets", () => {
    const id = (index: number) => `task-${String(index).padStart(3, "0")}`
    const tasks = Array.from({ length: 500 }, (_, index) =>
      taskFixture({
        id: id(index),
        title: `Task ${String(index).padStart(3, "0")}`,
        phase: index % 4 === 0 ? "Build" : "Verify",
        order: index,
        dependsOn: index % 25 === 0 ? [] : [id(index - 1)],
      }),
    )
    const measure: GraphMeasurer = (task) => ({
      width: GRAPH_NODE_WIDTH,
      height: GRAPH_NODE_HEIGHT + (task.title.length % 5) * 8,
    })

    const layoutRuns: number[] = []
    for (let index = 0; index < 5; index += 1) {
      resetLayoutCache()
      const start = performance.now()
      const layout = layoutTaskGraph(tasks, measure)
      layoutRuns.push(performance.now() - start)
      expect(layout.nodes).toHaveLength(500)
      expect(layout.edges).toHaveLength(480)
    }
    const layoutMs = Math.min(...layoutRuns)

    resetLayoutCache()
    const first = cachedLayout(tasks, measure, "13:18:1")
    const statusChanged = tasks.map((task) => ({ ...task, state: "running" as const }))
    const statusRuns: number[] = []
    for (let index = 0; index < 5; index += 1) {
      const start = performance.now()
      const next = cachedLayout(statusChanged, measure, "13:18:1")
      statusRuns.push(performance.now() - start)
      expect(next).toBe(first)
    }
    const statusMs = Math.min(...statusRuns)

    console.log(
      `[task-13-perf] layout500min=${layoutMs.toFixed(2)}ms runs=${layoutRuns.map((value) => value.toFixed(2)).join(",")} statusUpdate=${statusMs.toFixed(3)}ms`,
    )
    expect(layoutMs).toBeLessThan(250)
    expect(statusMs).toBeLessThan(100)
  })

  test("rejects a dependency cycle", () => {
    const tasks = [
      taskFixture({ id: "a", dependsOn: ["b"] }),
      taskFixture({ id: "b", dependsOn: ["a"] }),
    ]
    expect(() => layoutTaskGraph(tasks)).toThrow(/cycle/i)
  })

  test("rejects unknown dependencies, duplicate ids, and self dependencies", () => {
    expect(() => layoutTaskGraph([taskFixture({ id: "a", dependsOn: ["missing"] })])).toThrow(/unknown/i)
    expect(() => layoutTaskGraph([taskFixture({ id: "a" }), taskFixture({ id: "a" })])).toThrow(/duplicate/i)
    expect(() => layoutTaskGraph([taskFixture({ id: "a", dependsOn: ["a"] })])).toThrow(/cycle/i)
  })

  test("grows measured node height instead of clipping expanded text", () => {
    const measure: GraphMeasurer = (task) => ({ width: GRAPH_NODE_WIDTH, height: task.id === "api" ? 140 : GRAPH_NODE_HEIGHT })
    const layout = layoutTaskGraph(taskGraphFixture(), measure)
    const api = nodeByID(layout, "api")
    const cli = nodeByID(layout, "cli")
    expect(api.height).toBe(140)
    expect(api.width).toBe(GRAPH_NODE_WIDTH)
    expect(cli.y).toBe(api.y + 140 + GRAPH_VERTICAL_GAP)
    expect(layout.height).toBeGreaterThan(140)
  })

  test("positions depend only on topology, order, and dimensions", () => {
    const tasks = taskGraphFixture()
    const base = layoutTaskGraph(tasks)
    const restated = layoutTaskGraph(
      tasks.map((task) => ({
        ...task,
        state: "skipped",
        attempt: 7,
        reason: "removed",
      })),
    )
    expect(restated.nodes).toEqual(base.nodes)
    expect(restated.edges).toEqual(base.edges)
  })
})

describe("graphSignature", () => {
  test("excludes state, attempt, reason, and evidence", () => {
    const tasks = taskGraphFixture()
    const left = graphSignature(tasks)
    const right = graphSignature(
      tasks.map((task) => ({ ...task, state: "failed", attempt: 3, reason: "changed" })),
    )
    expect(right).toBe(left)
  })

  test("includes id, order, sorted dependencies, and title", () => {
    const base = [taskFixture({ id: "a", order: 1, dependsOn: ["c", "b"], title: "A" })]
    const reordered = [{ ...base[0], dependsOn: ["b", "c"] }]
    expect(graphSignature(reordered)).toBe(graphSignature(base))
    expect(graphSignature([{ ...base[0], order: 2 }])).not.toBe(graphSignature(base))
    expect(graphSignature([{ ...base[0], title: "B" }])).not.toBe(graphSignature(base))
    expect(graphSignature([{ ...base[0], id: "z" }])).not.toBe(graphSignature(base))
  })
})

describe("cachedLayout", () => {
  test("reuses the layout for a topology-only signature", () => {
    const tasks = taskGraphFixture()
    const first = cachedLayout(tasks)
    const second = cachedLayout(tasks.map((task) => ({ ...task, state: "running" })))
    expect(second).toBe(first)
    expect(second.nodes).toEqual(first.nodes)
  })

  test("relayouts when topology changes", () => {
    const first = cachedLayout(taskGraphFixture())
    const second = cachedLayout(taskGraphFixture().concat(taskFixture({ id: "added", order: 9 })))
    expect(second).not.toBe(first)
    expect(second.nodes.some((node) => node.id === "added")).toBe(true)
  })

  test("relayouts when measured dimensions change and reuses otherwise", () => {
    resetLayoutCache()
    const tasks = taskGraphFixture()
    const short: GraphMeasurer = () => ({ width: GRAPH_NODE_WIDTH, height: GRAPH_NODE_HEIGHT })
    const tall: GraphMeasurer = () => ({ width: GRAPH_NODE_WIDTH, height: 140 })
    const first = cachedLayout(tasks, short, "13:18:1")
    expect(nodeByID(first, "schema").height).toBe(GRAPH_NODE_HEIGHT)
    expect(cachedLayout(tasks.map((task) => ({ ...task, state: "running" })), short, "13:18:1")).toBe(first)
    const resized = cachedLayout(tasks, tall, "26:36:1")
    expect(resized).not.toBe(first)
    expect(nodeByID(resized, "schema").height).toBe(140)
  })
})

describe("clampZoom", () => {
  test("clamps to the supported zoom range", () => {
    expect(clampZoom(0.01)).toBe(GRAPH_MIN_ZOOM)
    expect(clampZoom(9)).toBe(GRAPH_MAX_ZOOM)
    expect(clampZoom(1.25)).toBe(1.25)
    expect(GRAPH_MIN_ZOOM).toBe(0.25)
    expect(GRAPH_MAX_ZOOM).toBe(2)
  })
})

describe("groupTasksByPhase", () => {
  test("preserves every task identity and the completion counts", () => {
    const tasks = taskGraphFixture().map((task, index) => ({
      ...task,
      state: index === 0 ? ("verified" as const) : task.state,
    }))
    const groups = groupTasksByPhase(tasks)
    const flattened = groups.flatMap((group) => group.tasks)
    expect(flattened).toHaveLength(tasks.length)
    expect(new Set(flattened.map((task) => task.id))).toEqual(new Set(tasks.map((task) => task.id)))
    expect(groupTasksByPhase(tasks).flatMap((group) => group.tasks).map((task) => task.id)).toEqual(
      flattened.map((task) => task.id),
    )
    expect(summarizeProgress(flattened)).toEqual(summarizeProgress(tasks))
    expect(groups.map((group) => group.phase)).toEqual([...new Set(tasks.map((task) => task.phase))].sort())
    expect(GRAPH_GROUPING_THRESHOLD).toBe(200)
  })

  test("orders tasks inside each phase by order and id", () => {
    const groups = groupTasksByPhase([
      taskFixture({ id: "b", phase: "Build", order: 1 }),
      taskFixture({ id: "a", phase: "Build", order: 0 }),
      taskFixture({ id: "c", phase: "Review", order: 0 }),
    ])
    expect(groups.map((group) => group.phase)).toEqual(["Build", "Review"])
    expect(groups[0]!.tasks.map((task) => task.id)).toEqual(["a", "b"])
    expect(groups[1]!.tasks.map((task) => task.id)).toEqual(["c"])
  })
})
