import { expect, test } from "bun:test"
import { analyzeCpu, analyzeTrace, parseHeap } from "../src/main/browser/analysis"

test("trace analysis reports observed durations without inventing Web Vitals", () => {
  const result = analyzeTrace({
    traceEvents: [
      { name: "RunTask", ph: "X", dur: 75_000 },
      { name: "Paint", ph: "X", dur: 2_500 },
      { name: "Paint", ph: "X", dur: 1_000 },
      { name: "marker", ph: "i" },
    ],
  })
  expect(result.metrics).toEqual([
    { name: "recordedEvents", value: 4, unit: "count" },
    { name: "longTasks", value: 1, unit: "count" },
    { name: "longTaskBlocking", value: 25, unit: "ms" },
  ])
  expect(result.events).toContainEqual({ name: "Paint", count: 2, totalMs: 3.5, maxMs: 2.5 })
})

test("CPU analysis attributes sample intervals to their functions", () => {
  const result = analyzeCpu({
    startTime: 0,
    endTime: 6000,
    nodes: [
      { id: 1, callFrame: { functionName: "first", url: "a.js", lineNumber: 0 } },
      { id: 2, callFrame: { functionName: "second", url: "b.js", lineNumber: 2 } },
    ],
    samples: [1, 2, 1],
    timeDeltas: [1000, 2000, 3000],
  })
  expect(result.durationMs).toBe(6)
  expect(result.functions).toEqual([
    { name: "first", url: "a.js", line: 1, selfMs: 4 },
    { name: "second", url: "b.js", line: 3, selfMs: 2 },
  ])
})

test("heap queries and object links use snapshot IDs and shallow sizes", () => {
  const heap = parseHeap({
    snapshot: {
      meta: {
        node_fields: ["type", "name", "id", "self_size", "edge_count"],
        node_types: [["object"], "string", "number", "number", "number"],
        edge_fields: ["type", "name_or_index", "to_node"],
        edge_types: [["property", "weak"], "string", "node"],
      },
    },
    // root -next-> child, plus a WeakRef whose weak "target" edge points at child too.
    nodes: [0, 0, 1, 10, 1, 0, 1, 3, 20, 0, 0, 3, 5, 8, 1],
    edges: [0, 2, 5, 1, 4, 5],
    strings: ["root", "child", "next", "WeakRef", "target"],
  })
  expect(heap.summary()).toMatchObject({ nodes: 3, edges: 2, selfBytes: 38 })
  expect(heap.query("", 1)).toMatchObject({ nodes: [{ id: 3, selfBytes: 20 }], truncated: true })
  expect(heap.object(1).references).toMatchObject([{ name: "next", node: { id: 3 } }])
  expect(heap.object(5).references).toMatchObject([{ name: "target", node: { id: 3 } }])
  // The weak edge is visible from its owner but never counts as keeping the child alive.
  expect(heap.object(3).retainers).toEqual([{ name: "next", node: expect.objectContaining({ id: 1 }) }])
  expect(() => heap.object(99)).toThrow("Object ID was not found")
})

test("heap parsing rejects edge counts and targets the file does not carry", () => {
  const meta = {
    node_fields: ["type", "name", "id", "self_size", "edge_count"],
    node_types: [["object"], "string", "number", "number", "number"],
    edge_fields: ["type", "name_or_index", "to_node"],
    edge_types: [["property"], "string", "node"],
  }
  // A trillion claimed edges with an empty edge array must fail at parse time, not traverse.
  expect(() => parseHeap({ snapshot: { meta }, nodes: [0, 0, 1, 10, 1e12], edges: [], strings: ["root"] })).toThrow(
    "unsupported or incomplete",
  )
  expect(() => parseHeap({ snapshot: { meta }, nodes: [0, 0, 1, 10, 1], edges: [0, 0, 7], strings: ["root"] })).toThrow(
    "unsupported or incomplete",
  )
})
