import { test, expect } from "bun:test"
import { runBenchmark, publishResult, writeResults } from "@/terminal/bench/BenchmarkRunner"
import { SeededRandom } from "@/terminal/bench/SeededRandom"
import { wordWrap } from "@/terminal/widgets/Text"

const rng = new SeededRandom(0xdeadbeef)

const ASCII = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 "
const CJK_CHARS = "\u4e2d\u56fd\u4eba\u6c11\u5171\u548c\u56fd\u662f\u4e00\u4e2a\u5927\u56fd"

function generateText(length: number): string {
  let out = ""
  for (let i = 0; i < length; i++) {
    if (rng.next() < 0.5) out += rng.pick(ASCII.split(""))
    else out += rng.pick(CJK_CHARS.split(""))
  }
  return out
}

function naiveWrap(text: string, mw: number): string[] {
  if (mw <= 0 || !text) return []
  const lines: string[] = []
  for (let i = 0; i < text.length; i += mw) {
    lines.push(text.slice(i, i + mw))
  }
  return lines
}

const TEXT = generateText(500_000)
const MAX_WIDTH = 40
const BENCH_TIMEOUT = 120000

test("[CJK] word wrap throughput", () => {
  const result = runBenchmark({
    name: "cjk/throughput",
    baseline: () => { naiveWrap(TEXT, MAX_WIDTH) },
    optimized: () => { wordWrap(TEXT, MAX_WIDTH) },
  })

  publishResult(result)
  writeResults()

  const baselineCharsPerSec = (TEXT.length / (result.baselineMean / 1e9))
  const optimizedCharsPerSec = (TEXT.length / (result.mean / 1e9))
  const ratio = result.baselineRatio

  expect(result.cv).toBeLessThan(0.15)

  console.log(`[CJK] baseline: ${(baselineCharsPerSec / 1e6).toFixed(2)}M chars/sec`)
  console.log(`[CJK] optimized: ${(optimizedCharsPerSec / 1e6).toFixed(2)}M chars/sec`)
  console.log(`[CJK] ratio (opt/base): ${ratio.toFixed(3)} (lower=better)`)
  console.log(`[CJK] CV: ${(result.cv * 100).toFixed(2)}%`)
}, { timeout: BENCH_TIMEOUT })
