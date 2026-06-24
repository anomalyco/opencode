import { test, expect } from "bun:test"
import { runBenchmark, publishResult, writeResults } from "@/terminal/bench/BenchmarkRunner"
import { SeededRandom } from "@/terminal/bench/SeededRandom"
import { Flex } from "@/terminal/layout/Flex"
import type { LayoutNode } from "@/terminal/layout/Types"

const rng = new SeededRandom(0xdeadbeef)

function generateTree(depth: number, breadth: number): LayoutNode {
  if (depth === 0) {
    return { x: 0, y: 0, width: 0, height: 0, grow: rng.int(0, 3), shrink: rng.int(0, 2), children: [] }
  }
  const children: LayoutNode[] = []
  const count = rng.int(2, breadth)
  for (let i = 0; i < count; i++) {
    children.push(generateTree(depth - 1, breadth))
  }
  return {
    x: 0, y: 0, width: 100, height: 50,
    direction: rng.next() < 0.5 ? "row" : "column",
    grow: 0, shrink: 0, padding: [0, 0, 0, 0], margin: [0, 0, 0, 0], borderWidth: 0,
    children,
  }
}

function naiveSolve(node: LayoutNode, aw: number, ah: number): void {
  const count = node.children.length
  if (count === 0) return
  const cw = aw / count
  const ch = ah
  for (let i = 0; i < count; i++) {
    const child = node.children[i]!
    const result = {
      x: node.x + i * cw, y: node.y, width: cw, height: ch,
      direction: "row" as const, grow: 0, shrink: 0,
      padding: [0, 0, 0, 0] as [number, number, number, number],
      margin: [0, 0, 0, 0] as [number, number, number, number],
      borderWidth: 0,
      children: child.children,
    }
    child.x = result.x; child.y = result.y; child.width = result.width; child.height = result.height
    if (child.children.length > 0) naiveSolve(child, cw, ch)
  }
}

const TREES: { node: LayoutNode; aw: number; ah: number }[] = []
for (let i = 0; i < 6000; i++) {
  TREES.push({ node: generateTree(3, 5), aw: 120, ah: 60 })
}

const flex = new Flex()
const FLEX_REPEAT = 10
const BENCH_TIMEOUT = 120000

test("[Flex] solver throughput", () => {
  const result = runBenchmark({
    name: "flex/solver",
    baseline: () => {
      for (let r = 0; r < FLEX_REPEAT; r++) {
        for (const { node, aw, ah } of TREES) {
          naiveSolve(node, aw, ah)
        }
      }
    },
    optimized: () => {
      for (let r = 0; r < FLEX_REPEAT; r++) {
        for (const { node, aw, ah } of TREES) {
          flex.solve(node, aw, ah)
        }
      }
    },
  })

  publishResult(result)
  writeResults()

  const totalNodes = TREES.reduce((sum, { node }) => sum + countNodes(node), 0)
  const baselineNsPerNode = result.baselineMean / totalNodes
  const optimizedNsPerNode = result.mean / totalNodes
  const baselineNodesPerSec = totalNodes / (result.baselineMean / 1e9)
  const optimizedNodesPerSec = totalNodes / (result.mean / 1e9)

  expect(result.cv).toBeLessThan(0.15)

  console.log(`[Flex] total nodes: ${totalNodes}`)
  console.log(`[Flex] baseline: ${(baselineNodesPerSec / 1e3).toFixed(2)}K nodes/sec (${baselineNsPerNode.toFixed(1)} ns/node)`)
  console.log(`[Flex] optimized: ${(optimizedNodesPerSec / 1e3).toFixed(2)}K nodes/sec (${optimizedNsPerNode.toFixed(1)} ns/node)`)
  console.log(`[Flex] ratio (opt/base): ${result.baselineRatio.toFixed(3)} (lower=better)`)
  console.log(`[Flex] CV: ${(result.cv * 100).toFixed(2)}%`)
}, { timeout: BENCH_TIMEOUT })

function countNodes(node: LayoutNode): number {
  return 1 + node.children.reduce((s, c) => s + countNodes(c), 0)
}
