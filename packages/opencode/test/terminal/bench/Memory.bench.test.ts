import { test, expect } from "bun:test"
import { runBenchmark, publishResult, writeResults } from "@/terminal/bench/BenchmarkRunner"
import { List } from "@/terminal/widgets/List"
import { ScreenBuffer } from "@/terminal/core/ScreenBuffer"

const ITEM_COUNT = 100_000

function buildItems(): string[] {
  const items: string[] = new Array(ITEM_COUNT)
  for (let i = 0; i < ITEM_COUNT; i++) items[i] = `item-${i}-${"x".repeat(20)}`
  return items
}

function rss(): number {
  return process.memoryUsage().rss
}

const BENCH_TIMEOUT = 120000

test("[Memory] virtualization memory", () => {
  const items = buildItems()

  // Baseline: create list, render once. Measure RSS after GC.
  const list = new List()
  list.items = items
  list.setBounds(0, 0, 30, 5)
  const baselineBuf = new ScreenBuffer(30, 5)
  list.render(baselineBuf)
  Bun.gc(true)
  const baselineRss = rss()

  // Scroll 100K items, then measure RSS after GC to detect leaks
  const arrowDown = { type: "KEY", key: "ArrowDown" } as const
  for (let i = 0; i < 99999; i++) list.onKey(arrowDown)
  Bun.gc(true)
  const scrollRss = rss()

  const leakKB = (scrollRss - baselineRss) / 1024

  const list2 = new List()
  list2.items = items
  list2.setBounds(0, 0, 30, 5)

  const MEM_REPEAT = 20000

  const result = runBenchmark({
    name: "memory/virtualization",
    baseline: () => {
      for (let r = 0; r < MEM_REPEAT; r++) {
        const buf = new ScreenBuffer(30, 5)
        for (let i = 0; i < 5; i++) {
          const line = items[i] ?? ""
          for (let c = 0; c < Math.min(30, line.length); c++) {
            buf.setCell(c, i, line.codePointAt(c) ?? 32, 15, 0, 0)
          }
        }
      }
    },
    optimized: () => {
      for (let r = 0; r < MEM_REPEAT; r++) {
        list2.render(new ScreenBuffer(30, 5))
      }
    },
  })

  publishResult(result)
  writeResults()

  expect(result.cv).toBeLessThan(0.15)
  expect(baselineRss).toBeGreaterThan(0)
  expect(scrollRss).toBeGreaterThan(0)

  console.log(`[Memory] baseline RSS (post-GC): ${(baselineRss / 1024).toFixed(2)} KB`)
  console.log(`[Memory] after 100K scroll RSS (post-GC): ${(scrollRss / 1024).toFixed(2)} KB`)
  console.log(`[Memory] RSS delta (leak indicator): ${leakKB.toFixed(2)} KB`)
  console.log(`[Memory] render ratio (opt/base): ${result.baselineRatio.toFixed(3)} (lower=better)`)
  console.log(`[Memory] CV: ${(result.cv * 100).toFixed(2)}%`)
  console.log(`[Memory] items: ${ITEM_COUNT}, viewport: 30x5`)

  // RSS should not grow significantly from 100K scrolls (< 1MB is noise from GC jitter)
  expect(Math.abs(leakKB)).toBeLessThan(1024)
}, { timeout: BENCH_TIMEOUT })
