import { test, expect } from "bun:test"
import { runBenchmark, publishResult, writeResults } from "@/terminal/bench/BenchmarkRunner"
import { SeededRandom } from "@/terminal/bench/SeededRandom"
import { SgrDelta } from "@/terminal/core/SgrDelta"

const rng = new SeededRandom(0xdeadbeef)

const FG_COLORS = [15, 196, 46, 226, 21, 201, 51, 88, 130, 240]
const BG_COLORS = [0, 4, 28, 58, 17, 53, 23, 52, 95, 232]

let inputSequences: string[] = []
for (let i = 0; i < 30000; i++) {
  const fg = rng.pick(FG_COLORS)
  const bg = rng.pick(BG_COLORS)
  const bold = rng.next() < 0.3 ? ";1" : ""
  inputSequences.push(`\x1b[${i + 1};1H\x1b[0;38;5;${fg};48;5;${bg}${bold}mX\x1b[0m`)
}
const INPUT = inputSequences.join("")

const rawBytes = Buffer.byteLength(INPUT)
const BENCH_TIMEOUT = 120000

function generateSequence(): string {
  let out = ""
  for (let i = 0; i < 1500; i++) {
    const fg = rng.pick(FG_COLORS)
    const bg = rng.pick(BG_COLORS)
    out += `\x1b[${i + 1};1H\x1b[0;38;5;${fg};48;5;${bg}mX\x1b[0m`
  }
  return out
}

test("[SGR] delta compression", () => {
  const delta = new SgrDelta()
  delta.resetState()

  const optimized = delta.optimize(INPUT)
  const optimizedBytes = Buffer.byteLength(optimized)
  const ratio = optimizedBytes / rawBytes

  const result = runBenchmark({
    name: "sgr/delta",

    baseline: () => {
      generateSequence()
    },

    optimized: () => {
      const d = new SgrDelta()
      d.resetState()
      d.optimize(INPUT)
    },
    maxCV: 0.25,
    iterations: 40,

  })

  publishResult(result)
  writeResults()

  expect(result.cv).toBeLessThan(0.25)

  console.log(`[SGR] raw bytes (no delta): ${rawBytes}`)
  console.log(`[SGR] optimized bytes: ${optimizedBytes}`)
  console.log(`[SGR] compression ratio: ${(ratio * 100).toFixed(1)}%`)
  console.log(`[SGR] savings: ${((1 - ratio) * 100).toFixed(1)}%`)
  console.log(`[SGR] timing ratio (opt/base): ${result.baselineRatio.toFixed(3)} (lower=better)`)
  console.log(`[SGR] CV: ${(result.cv * 100).toFixed(2)}%`)
}, { timeout: BENCH_TIMEOUT })

test("[SGR] same-color blocks", () => {
  // 30 blocks × 1000 lines each, each block has uniform color (same fg/bg)
  const BLOCKS = 30
  const LINES = 1000
  const parts: string[] = []
  for (let b = 0; b < BLOCKS; b++) {
    const fg = rng.pick(FG_COLORS)
    const bg = rng.pick(BG_COLORS)
    for (let l = 0; l < LINES; l++)
      parts.push(`\x1b[${b * LINES + l + 1};1H\x1b[0;38;5;${fg};48;5;${bg}mX\x1b[0m`)
  }
  const blockInput = parts.join("")
  const rawBytes = Buffer.byteLength(blockInput)

  const delta = new SgrDelta()
  delta.resetState()
  const optimized = delta.optimize(blockInput)
  const optimizedBytes = Buffer.byteLength(optimized)
  const ratio = optimizedBytes / rawBytes

  const result = runBenchmark({
    name: "sgr/same-color-blocks",

    baseline: () => {
      const d = new SgrDelta()
      d.resetState()
      // Rebuild same-pattern input to avoid caching interference
      let tmp = ""
      for (let b = 0; b < BLOCKS; b++) {
        const fg = rng.pick(FG_COLORS)
        const bg = rng.pick(BG_COLORS)
        for (let l = 0; l < LINES; l++)
          tmp += `\x1b[${b * LINES + l + 1};1H\x1b[0;38;5;${fg};48;5;${bg}mX\x1b[0m`
      }
      d.optimize(tmp)
    },

    optimized: () => {
      const d = new SgrDelta()
      d.resetState()
      d.optimize(blockInput)
    },
  })

  publishResult(result)
  writeResults()

  expect(result.cv).toBeLessThan(0.15)

  console.log(`[SGR:blocks] raw bytes: ${rawBytes}`)
  console.log(`[SGR:blocks] optimized bytes: ${optimizedBytes}`)
  console.log(`[SGR:blocks] compression ratio: ${(ratio * 100).toFixed(1)}%`)
  console.log(`[SGR:blocks] savings: ${((1 - ratio) * 100).toFixed(1)}%`)
  console.log(`[SGR:blocks] timing ratio (opt/base): ${result.baselineRatio.toFixed(3)} (lower=better)`)
  console.log(`[SGR:blocks] CV: ${(result.cv * 100).toFixed(2)}%`)
  console.log(`[SGR:blocks] blocks: ${BLOCKS}, lines each: ${LINES}, uniform colors per block`)
}, { timeout: BENCH_TIMEOUT })
