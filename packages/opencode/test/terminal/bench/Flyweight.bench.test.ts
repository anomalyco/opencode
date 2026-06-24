import { test, expect } from "bun:test"
import { runBenchmark, publishResult, writeResults } from "@/terminal/bench/BenchmarkRunner"
import { SeededRandom } from "@/terminal/bench/SeededRandom"
import { SgrFlyweight } from "@/terminal/core/SgrDelta"
import { AttrMask } from "@/terminal/core/Cell"

const rng = new SeededRandom(0xfeedface)

function buildSgrString(fg: number, bg: number, attr: number): string {
  const fgCode = fg === 0 ? "39" : `38;5;${fg}`
  const bgCode = bg === 0 ? "49" : `48;5;${bg}`
  const codes: string[] = ["0", fgCode, bgCode]
  if (attr & AttrMask.BOLD) codes.push("1")
  if (attr & AttrMask.ITALIC) codes.push("3")
  if (attr & AttrMask.UNDERLINE) codes.push("4")
  if (attr & AttrMask.STRIKE) codes.push("9")
  if (attr & AttrMask.INVERSE) codes.push("7")
  return `\x1b[${codes.join(";")}m`
}

const FG = [0, 15, 196, 46, 226, 21, 201, 51, 88, 130, 240]
const BG = [0, 4, 28, 58, 17, 53, 23, 52, 95, 232]
const ATTRS = [0, AttrMask.BOLD, AttrMask.UNDERLINE, AttrMask.ITALIC, AttrMask.BOLD | AttrMask.UNDERLINE, AttrMask.INVERSE]

function generateCombos(count: number): Array<[number, number, number]> {
  const out: Array<[number, number, number]> = []
  for (let i = 0; i < count; i++)
    out.push([rng.pick(FG), rng.pick(BG), rng.pick(ATTRS)])
  return out
}

function runBaselineCombos(combos: Array<[number, number, number]>): void {
  for (let i = 0; i < combos.length; i++)
    buildSgrString(combos[i][0], combos[i][1], combos[i][2])
}

function runOptimizedCombos(fw: SgrFlyweight, combos: Array<[number, number, number]>): void {
  for (let i = 0; i < combos.length; i++)
    fw.encode(combos[i][0], combos[i][1], combos[i][2])
}

const COMBOS = generateCombos(500000)

let flyweight: SgrFlyweight
const BENCH_TIMEOUT = 120000

test("[Flyweight] encode throughput", () => {
  flyweight = new SgrFlyweight()

  // Pre-warm flyweight cache with all combos to avoid cold-start variance
  runOptimizedCombos(flyweight, COMBOS)

  const result = runBenchmark({
    name: "flyweight/encode",
    baseline: () => { runBaselineCombos(COMBOS) },
    optimized: () => { runOptimizedCombos(flyweight, COMBOS) },
    maxCV: 0.15,
  })

  publishResult(result)
  writeResults()

  expect(result.cv).toBeLessThan(0.15)
  expect(flyweight.size).toBeGreaterThan(0)

  // Verify correctness: flyweight output must match string builder
  for (const [fg, bg, attr] of COMBOS.slice(0, 50)) {
    const expected = buildSgrString(fg, bg, attr)
    const actual = flyweight.encode(fg, bg, attr)
    expect(actual).toBe(expected)
  }

  const uniq = new Set(COMBOS.map(([f, b, a]) => (f << 16) | (b << 8) | a)).size
  console.log(`[Flyweight] total encodes: ${COMBOS.length}, unique keys: ${uniq}, cached: ${flyweight.size}`)
  console.log(`[Flyweight] timing ratio (opt/base): ${result.baselineRatio.toFixed(3)} (lower=better)`)
  console.log(`[Flyweight] CV: ${(result.cv * 100).toFixed(2)}%`)
}, { timeout: BENCH_TIMEOUT })
