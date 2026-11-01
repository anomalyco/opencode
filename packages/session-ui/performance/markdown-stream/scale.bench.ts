// Scaling sweep for `project()` in `src/components/markdown-stream.ts`.
//
// Streams one boundary-less paragraph of N words (one word per delta) and
// records total projection time plus the characters scanned by patchmark. A
// paragraph with no newline is a single active line, so each delta re-scans the
// whole line: scanned characters grow with the square of the text length, while
// wall time stays far below the pre-patchmark baseline.
//
// Run from `packages/session-ui`:
//   bun performance/markdown-stream/scale.bench.ts [output.json]

import { PatchmarkStream } from "@opencode/patchmark"
import { project, type Projection } from "../../src/components/markdown-stream"

const originalUpdate = PatchmarkStream.prototype.update

let updates = 0

let scannedChars = 0

PatchmarkStream.prototype.update = function (this: PatchmarkStream, text: string, options = {}) {
  const frame = originalUpdate.call(this, text, options)

  updates++
  scannedChars += frame.charsScanned

  return frame
}

const WORDS = [
  "the",
  "quick",
  "brown",
  "fox",
  "jumps",
  "over",
  "lazy",
  "dog",
  "while",
  "streaming",
  "markdown",
  "projection",
  "stays",
  "bounded",
  "per",
  "delta",
  "across",
  "the",
  "response",
]

function deltas(count: number) {
  return Array.from({ length: count }, (_, index) => `${WORDS[index % WORDS.length]} `)
}

function execute(words: number) {
  let projection: Projection | undefined
  let text = ""
  let totalNs = 0
  const startUpdates = updates
  const startChars = scannedChars

  for (const delta of deltas(words)) {
    text += delta
    const before = Bun.nanoseconds()
    projection = project(projection, text, true)
    totalNs += Bun.nanoseconds() - before
  }

  return {
    words,
    chars: text.length,
    totalMs: totalNs / 1e6,
    updates: updates - startUpdates,
    charsScanned: scannedChars - startChars,
  }
}

// Prime the JIT with a small run before measuring the sweep.
execute(100)

const sizes = [250, 500, 1000, 2000]

const results = sizes.map((size) => execute(size))

const report = {
  generator: "packages/session-ui/performance/markdown-stream/scale.bench.ts",
  bun: Bun.version,
  results,
}

console.log(JSON.stringify(report, null, 2))

const outputPath = process.argv[2]

if (outputPath) await Bun.write(outputPath, JSON.stringify(report, null, 2))
