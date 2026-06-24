import { test, expect } from "bun:test"
import { runBenchmark, publishResult, writeResults } from "@/terminal/bench/BenchmarkRunner"
import { Box } from "@/terminal/widgets/Box"
import { Text } from "@/terminal/widgets/Text"
import { ScreenBuffer } from "@/terminal/core/ScreenBuffer"

const BENCH_TIMEOUT = 120000

test("[Render] frame latency", () => {
  const root = new Box()
  root.borderWidth = 1
  root.direction = "row"
  root.setBounds(0, 0, 40, 20)

  const left = new Box()
  left.direction = "column"
  left.borderWidth = 1
  const leftText = new Text()
  leftText.content = "Left panel with some content that wraps"
  left.children = [leftText]

  const right = new Box()
  right.direction = "column"
  right.borderWidth = 1
  const rightText = new Text()
  rightText.content = "Right panel"
  right.children = [rightText]

  root.children = [left, right]

  const buf = new ScreenBuffer(40, 20)
  buf.clear()
  const RENDER_REPEAT = 2000

  const result = runBenchmark({
    name: "render/latency",

    baseline: () => {
      for (let r = 0; r < RENDER_REPEAT; r++) {
        buf.clear()
        root.dirty = true; left.dirty = true; right.dirty = true
        leftText.dirty = true; rightText.dirty = true
        root.render(buf)
      }
    },

    optimized: () => {
      for (let r = 0; r < RENDER_REPEAT; r++) {
        buf.clear()
        root.dirty = false; left.dirty = false; right.dirty = false
        leftText.dirty = false; rightText.dirty = false
        rightText.dirty = true
        root.render(buf)
      }
    },

  })

  publishResult(result)
  writeResults()

  const latencyUs = result.mean / 1000
  const baseLatencyUs = result.baselineMean / 1000

  expect(result.cv).toBeLessThan(0.15)

  console.log(`[Render] baseline: ${baseLatencyUs.toFixed(2)} µs/frame (full re-render)`)
  console.log(`[Render] optimized: ${latencyUs.toFixed(2)} µs/frame (dirty-flag incremental)`)
  console.log(`[Render] ratio (opt/base): ${result.baselineRatio.toFixed(3)} (lower=better)`)
  console.log(`[Render] CV: ${(result.cv * 100).toFixed(2)}%`)
  console.log(`[Render] tree: Box(border=1,row) → 2x Box(border=1,col) → Text`)
}, { timeout: BENCH_TIMEOUT })

test("[Render] deep tree 5-level", () => {
  const root = new Box()
  root.borderWidth = 1
  root.direction = "row"
  root.setBounds(0, 0, 80, 30)

  // Fan-out: 3 branches, each with 3-level chain to a heavy-content leaf
  const longText = `line A\nline B\nline C\nline D\nline E`
  const RENDER_REPEAT = 2000

  // Build 3 branches with explicit widget refs for dirty-flag control
  function buildBranch(text: string, side: string) {
    const b1 = new Box(); b1.borderWidth = 1; b1.direction = "column"
    const b2 = new Box(); b2.borderWidth = 1; b2.direction = "row"
    const b3 = new Box(); b3.borderWidth = 1; b3.direction = "column"
    const leaf = new Text(); leaf.content = text
    const clean = new Text(); clean.content = `${side}-content`
    b3.children = [leaf, clean]
    b2.children = [b3]
    b1.children = [b2]
    return { root: b1, leaf, b1, b2, b3, clean }
  }

  const a = buildBranch(longText, "A")
  const b = buildBranch(longText, "B")
  const c = buildBranch(longText, "C")

  root.children = [a.root, b.root, c.root]

  const buf = new ScreenBuffer(80, 30)
  buf.clear()

  const result = runBenchmark({
    name: "render/deep-tree",

    baseline: () => {
      for (let r = 0; r < RENDER_REPEAT; r++) {
        buf.clear()
        root.dirty = true; a.b1.dirty = true; a.b2.dirty = true; a.b3.dirty = true
        b.b1.dirty = true; b.b2.dirty = true; b.b3.dirty = true
        c.b1.dirty = true; c.b2.dirty = true; c.b3.dirty = true
        a.leaf.dirty = true; a.clean.dirty = true
        b.leaf.dirty = true; b.clean.dirty = true
        c.leaf.dirty = true; c.clean.dirty = true
        root.render(buf)
      }
    },

    optimized: () => {
      for (let r = 0; r < RENDER_REPEAT; r++) {
        buf.clear()
        root.dirty = false; a.b1.dirty = false; a.b2.dirty = false; a.b3.dirty = false
        b.b1.dirty = false; b.b2.dirty = false; b.b3.dirty = false
        c.b1.dirty = false; c.b2.dirty = false; c.b3.dirty = false
        a.leaf.dirty = false; a.clean.dirty = false
        b.leaf.dirty = false; b.clean.dirty = false
        c.leaf.dirty = false; c.clean.dirty = false
        c.leaf.dirty = true  // Only 1 leaf dirty
        root.render(buf)
      }
    },
  })

  publishResult(result)
  writeResults()

    expect(result.cv).toBeLessThan(0.15)

  const latencyUs = result.mean / 1000
  const baseLatencyUs = result.baselineMean / 1000

  console.log(`[Render:deep] baseline: ${baseLatencyUs.toFixed(2)} µs/frame (full re-render)`)
  console.log(`[Render:deep] optimized: ${latencyUs.toFixed(2)} µs/frame (dirty-flag incremental)`)
  console.log(`[Render:deep] ratio (opt/base): ${result.baselineRatio.toFixed(3)} (lower=better)`)
  console.log(`[Render:deep] CV: ${(result.cv * 100).toFixed(2)}%`)
  console.log(`[Render:deep] tree: 3 branches × 3-level Box chain → 1 dirty leaf + 2 heavy clean leaves`)
}, { timeout: BENCH_TIMEOUT })
