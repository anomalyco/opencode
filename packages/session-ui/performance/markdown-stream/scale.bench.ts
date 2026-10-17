// Scaling sweep for `project()` in `src/components/markdown-stream.ts`.
//
// Streams one boundary-less paragraph of N words (one word per delta) and
// records total projection time plus total characters passed to the marked
// lexer. The pre-change baseline re-lexes the whole accumulated message on
// every delta, so its work grows quadratically; the incremental projection
// grows the live tail in place, so its work grows linearly (only the residual
// `heal`/`remend` scan of the tail remains per delta).
//
// Run from `packages/session-ui`:
//   bun performance/markdown-stream/scale.bench.ts [output.json]

import { Marked } from "marked"
import { project, type Projection } from "../../src/components/markdown-stream"

const originalLexer = Marked.prototype.lexer

let lexCalls = 0

let lexChars = 0

Marked.prototype.lexer = function (this: Marked, text, ...rest) {
  lexCalls++
  lexChars += text.length

  return originalLexer.call(this, text, ...rest)
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
  const startCalls = lexCalls
  const startChars = lexChars

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
    lexCalls: lexCalls - startCalls,
    lexChars: lexChars - startChars,
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
