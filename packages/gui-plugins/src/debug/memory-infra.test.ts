import { expect, test } from "bun:test"
import { summarize } from "./memory-infra"

const hex = (mib: number) => Math.round(mib * 1024 * 1024).toString(16)

const size = (mib: number) => ({ type: "scalar", units: "bytes", value: hex(mib) })

// Shaped like Electron's trace: totals and allocators arrive in separate events per dump id, the browser splits its
// allocators over two events, and shared `global/…` entries carry no attrs.
const trace = {
  traceEvents: [
    { pid: 10, ph: "M", name: "process_name", args: { name: "Renderer" } },
    { pid: 10, ph: "M", name: "process_labels", args: { labels: "OpenCode" } },
    { pid: 20, ph: "M", name: "process_name", args: { name: "Browser" } },
    { pid: 10, ph: "X", name: "unrelated", args: { anything: [1, 2] } },
    // An earlier dump that a later one supersedes.
    { pid: 10, ph: "v", id: "0x0", args: { dumps: { process_totals: { private_footprint_bytes: hex(100) } } } },
    { pid: 10, ph: "v", id: "0x0", args: { dumps: { allocators: { malloc: { attrs: { size: size(90) } } } } } },
    { pid: 10, ph: "v", id: "0x1", args: { dumps: { process_totals: { private_footprint_bytes: hex(900) } } } },
    {
      pid: 10,
      ph: "v",
      id: "0x1",
      args: {
        dumps: {
          allocators: {
            // Effective size wins over size: memory shared with another allocator is counted once.
            cc: { attrs: { size: size(500), effective_size: size(400) } },
            "cc/tile_memory": { attrs: { effective_size: size(400) } },
            partition_alloc: { attrs: { size: size(300) } },
            "partition_alloc/partitions/layout": { attrs: { size: size(250) } },
            "partition_alloc/partitions/layout/deeper": { attrs: { size: size(250) } },
            "partition_alloc/partitions/tiny": { attrs: { size: size(0.5) } },
            "shared_memory/ABC": { attrs: { size: size(5) } },
            "global/123": {},
          },
        },
      },
    },
    { pid: 20, ph: "v", id: "0x1", args: { dumps: { process_totals: { private_footprint_bytes: hex(200) } } } },
    { pid: 20, ph: "v", id: "0x1", args: { dumps: { allocators: { malloc: { attrs: { size: size(50) } } } } } },
    { pid: 20, ph: "v", id: "0x1", args: { dumps: { allocators: { v8: { attrs: { size: size(30) } } } } } },
    // The recording stopped while the next dump was arriving: only the renderer reported, so 0x1 stays the answer.
    { pid: 10, ph: "v", id: "0x2", args: { dumps: { process_totals: { private_footprint_bytes: hex(950) } } } },
    { pid: 10, ph: "v", id: "0x2", args: { dumps: { allocators: { malloc: { attrs: { size: size(950) } } } } } },
    { pid: 20, ph: "v", id: "0x2", args: { dumps: { process_totals: { private_footprint_bytes: hex(210) } } } },
  ],
}

test("summarizes each process's latest complete dump, largest first", () => {
  expect(summarize(JSON.stringify(trace))).toEqual([
    {
      pid: 10,
      name: "Renderer",
      labels: "OpenCode",
      totals: { privateFootprint: 900, resident: undefined },
      allocators: { cc: 400, partition_alloc: 300 },
      detail: { "cc/tile_memory": 400, "partition_alloc/partitions/layout": 250 },
    },
    {
      pid: 20,
      name: "Browser",
      labels: undefined,
      totals: { privateFootprint: 200, resident: undefined },
      allocators: { malloc: 50, v8: 30 },
      detail: {},
    },
  ])
})

test("falls back to the latest dump with allocators when no dump reached every process", () => {
  const partial = {
    traceEvents: [
      { pid: 10, ph: "v", id: "0x0", args: { dumps: { allocators: { malloc: { attrs: { size: size(10) } } } } } },
      { pid: 20, ph: "v", id: "0x0", args: { dumps: { process_totals: { private_footprint_bytes: hex(20) } } } },
    ],
  }

  expect(
    summarize(JSON.stringify(partial)).map((item) => [item.pid, item.totals.privateFootprint, item.allocators]),
  ).toEqual([
    [20, 20, {}],
    [10, undefined, { malloc: 10 }],
  ])
})

test("a trace without memory dumps summarizes to nothing", () => {
  expect(summarize(JSON.stringify({ traceEvents: [{ pid: 1, ph: "M", name: "process_name" }] }))).toEqual([])
})
