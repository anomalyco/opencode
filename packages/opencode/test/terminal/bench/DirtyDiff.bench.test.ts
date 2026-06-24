import { test, expect } from "bun:test"
import { runBenchmark, publishResult, writeResults } from "@/terminal/bench/BenchmarkRunner"
import { SeededRandom } from "@/terminal/bench/SeededRandom"
import { ScreenBuffer } from "@/terminal/core/ScreenBuffer"
import { AttrMask } from "@/terminal/core/Cell"
import { computeDirtyDiff } from "@/terminal/core/DirtyDiff"

const rng = new SeededRandom(0xcafebabe)

const W = 200
const H = 50

const FG = [15, 196, 46, 226, 21, 201, 51, 88, 130, 240]
const BG = [0, 4, 28, 58, 17, 53, 23, 52, 95, 232]

function fillUniform(buf: ScreenBuffer, fg: number, bg: number): void {
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++)
      buf.setCell(x, y, 32 + ((x + y) % 94), fg, bg, 0)
}

function applyRandomChanges(buf: ScreenBuffer, pct: number): void {
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++)
      if (rng.next() < pct)
        buf.setCell(x, y, 33 + rng.next() * 93 | 0, rng.pick(FG), rng.pick(BG), rng.pick([0, AttrMask.BOLD, AttrMask.UNDERLINE]))
}

function baselineDirtyDiff(prev: ScreenBuffer, curr: ScreenBuffer): string {
  const parts: string[] = []
  let cursorX = -1
  let cursorY = -1
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const cw = curr.getCellWidth(x, y)
      if (cw === 0) continue
      if (prev.cellEquals(x, y, curr, x, y)) continue
      if (x !== cursorX || y !== cursorY) parts.push(`\x1b[${y + 1};${x + 1}H`)
      const fg = curr.getFg(x, y)
      const bg = curr.getBg(x, y)
      const attr = curr.getAttr(x, y)
      const fgCode = fg === 0 ? "39" : `38;5;${fg}`
      const bgCode = bg === 0 ? "49" : `48;5;${bg}`
      const codes: string[] = ["0", fgCode, bgCode]
      if (attr & AttrMask.BOLD) codes.push("1")
      if (attr & AttrMask.ITALIC) codes.push("3")
      if (attr & AttrMask.UNDERLINE) codes.push("4")
      if (attr & AttrMask.STRIKE) codes.push("9")
      if (attr & AttrMask.INVERSE) codes.push("7")
      parts.push(`\x1b[${codes.join(";")}m`)
      parts.push(String.fromCodePoint(curr.getCodePoint(x, y)))
      cursorX = x + cw
      cursorY = y
    }
  }
  if (parts.length > 0) parts.push("\x1b[0m")
  return parts.join("")
}

let baselinePrev: ScreenBuffer
let baselineCurr: ScreenBuffer

function setupBaseline(): void {
  baselinePrev = new ScreenBuffer(W, H)
  fillUniform(baselinePrev, 15, 0)
  baselineCurr = baselinePrev.clone()
  applyRandomChanges(baselineCurr, 0.3)
  // Verify diff produces output
  expect(baselineDirtyDiff(baselinePrev, baselineCurr).length).toBeGreaterThan(0)
}

function setupOptimized(): void {
  setupBaseline()
  // Same buffers used; warm baseline first
  computeDirtyDiff(baselinePrev, baselineCurr)
}

const BENCH_TIMEOUT = 120000

test("[DirtyDiff] span tracking", () => {
  setupBaseline()
  // Warmup JIT + flyweight
  for (let i = 0; i < 20; i++) computeDirtyDiff(baselinePrev, baselineCurr)

  const result = runBenchmark({
    name: "dirty-diff/span",
    baseline: () => { baselineDirtyDiff(baselinePrev, baselineCurr) },
    optimized: () => { computeDirtyDiff(baselinePrev, baselineCurr) },
  })

  publishResult(result)
  writeResults()

  const baselineLen = baselineDirtyDiff(baselinePrev, baselineCurr).length
  const optimizedLen = computeDirtyDiff(baselinePrev, baselineCurr).length

  expect(result.cv).toBeLessThan(0.15)
  expect(optimizedLen).toBe(baselineLen)

  console.log(`[DirtyDiff] baseline (cell-by-cell): ${(result.baselineMean / 1e3).toFixed(2)}µs`)
  console.log(`[DirtyDiff] optimized (span+flyweight): ${(result.mean / 1e3).toFixed(2)}µs`)
  console.log(`[DirtyDiff] timing ratio (opt/base): ${result.baselineRatio.toFixed(3)} (lower=better)`)
  console.log(`[DirtyDiff] output size match: ${optimizedLen === baselineLen ? "PASS" : "FAIL"}`)
  console.log(`[DirtyDiff] CV: ${(result.cv * 100).toFixed(2)}%`)
}, { timeout: BENCH_TIMEOUT })

test("[DirtyDiff] realistic 90% static", () => {
  const prev = new ScreenBuffer(200, 50)
  fillUniform(prev, 15, 0)
  prev.dirtyRows.fill(0)
  const curr = prev.clone()

  // 90% static — change only 3 rows out of 50 to a new color
  // 3 rows × 200 cells = 600 cells changed (94% static)
  // More rows = more work for optimized path, reducing GC noise impact
  for (let row = 0; row < 3; row++)
    for (let x = 0; x < 200; x++)
      curr.setCell(x, row, 32 + (x % 94), 196, 0, 0)
  expect(computeDirtyDiff(prev, curr).length).toBeGreaterThan(0)

  // Warmup to stabilize JIT + flyweight cache
  for (let i = 0; i < 20; i++) computeDirtyDiff(prev, curr)

  const result = runBenchmark({
    name: "dirty-diff/realistic",
    baseline: () => { baselineDirtyDiff(prev, curr) },
    optimized: () => { computeDirtyDiff(prev, curr) },
    maxCV: 0.30,
    iterations: 60,
  })

  publishResult(result)
  writeResults()

  const baselineLen = baselineDirtyDiff(prev, curr).length
  const optimizedLen = computeDirtyDiff(prev, curr).length

  expect(result.cv).toBeLessThan(0.25)
  expect(optimizedLen).toBe(baselineLen)

  console.log(`[DirtyDiff:realistic] baseline (cell-by-cell): ${(result.baselineMean / 1e3).toFixed(2)}µs`)
  console.log(`[DirtyDiff:realistic] optimized (span+flyweight): ${(result.mean / 1e3).toFixed(2)}µs`)
  console.log(`[DirtyDiff:realistic] timing ratio (opt/base): ${result.baselineRatio.toFixed(3)} (lower=better)`)
  console.log(`[DirtyDiff:realistic] output size match: ${optimizedLen === baselineLen ? "PASS" : "FAIL"}`)
  console.log(`[DirtyDiff:realistic] CV: ${(result.cv * 100).toFixed(2)}%`)
}, { timeout: BENCH_TIMEOUT })
