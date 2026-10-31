// Micro-benchmark for `project()` in `src/components/markdown-stream.ts`.
//
// It streams deterministic fixtures through `project(previous, text, true)`
// with the same small-delta cadence a provider emits tokens, and measures:
//
//   - total projection time for the whole response,
//   - per-update latency (median / p95 / p99 / max),
//   - patchmark stream updates and source characters scanned (`charsScanned`).
//
// The scanner counters wrap `PatchmarkStream.prototype.update`, which `project()`
// calls once per delta. `charsScanned` is the incremental parser's own measure of
// work for that update, so the totals show how much of the accumulated message is
// re-scanned as it grows.
//
// Run from `packages/session-ui`:
//   bun performance/markdown-stream/project.bench.ts [output.json] [reps]
//
// This harness deliberately calls `project()` directly. It does not mount Solid,
// the worker, or the reactive store, so it measures projection CPU only.

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

type Workload = {
  name: string
  description: string
  // Delivered before the timed stream starts (models a message that already has
  // completed content), as a single projection call.
  prefix?: string
  deltas: string[]
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

function words(count: number, seed = 0) {
  const out: string[] = []

  for (let index = 0; index < count; index++) out.push(WORDS[(index + seed) % WORDS.length]!)

  return out.join(" ")
}

function paragraph(count: number, seed: number) {
  return `${words(count, seed)}.\n\n`
}

function makeWorkloads(): Workload[] {
  // A. Many small paragraph deltas. Each delta is a full short paragraph plus a
  // blank line, so every delta introduces a block boundary.
  const manyParagraphs: string[] = []

  for (let index = 0; index < 200; index++) manyParagraphs.push(paragraph(6 + (index % 3), index))

  // B. One long paragraph with no blank-line boundaries. One word per delta.
  const oneParagraph: string[] = []

  for (let index = 0; index < 2000; index++) oneParagraph.push(`${WORDS[index % WORDS.length]} `)

  // C. Many completed paragraphs followed by a growing live tail. The completed
  // paragraphs are delivered up front; only the final paragraph grows.
  const completedHead = Array.from({ length: 40 }, (_, index) => paragraph(8, index)).join("")
  const liveTail: string[] = []

  for (let index = 0; index < 500; index++) liveTail.push(`${WORDS[index % WORDS.length]} `)

  // D. Representative long mixed response: headings, prose, lists, a table,
  // and code fences, streamed in token-sized chunks.
  const mixedSections = [
    "# Streaming benchmark\n\n",
    "This response mixes ordinary prose with structural markdown so the projection sees more than plain text. ",
    "It should keep per-delta work bounded while streaming, even as the accumulated text grows to many kilobytes.\n\n",
  ]

  for (let section = 0; section < 10; section++) {
    mixedSections.push(
      `## Section ${section + 1}\n\n`,
      `${words(50, section)} ${words(40, section + 3)}.\n\n`,
      `### Details\n\n`,
      `- first item with ${words(8, section)}\n`,
      `- second item with \`inline code ${section}\`\n`,
      `- third item with a [link](https://example.com/${section})\n\n`,
      `| column | value | note |\n| --- | --- | --- |\n`,
      `| alpha | ${section} | ${words(3, section)} |\n`,
      `| beta | ${section + 1} | ${words(3, section + 1)} |\n\n`,
      `\`\`\`ts\nexport function add${section}(a: number, b: number) {\n  return a + b + ${section}\n}\n\`\`\`\n\n`,
    )
  }

  mixedSections.push(
    "The closing paragraph keeps the tail live for a little longer so the final block is still growing. ",
    `${words(60, 9)}.\n`,
  )
  const mixed = mixedSections.join("")
  const mixedDeltas = chunk(mixed, 8)

  // E. Growing list, one item per few deltas.
  const listDeltas: string[] = []

  for (let index = 0; index < 300; index++) listDeltas.push(`- item ${index} with ${words(4, index)}\n`)

  // F. Growing table, one row per delta.
  const tableDeltas: string[] = ["| a | b |\n", "| --- | --- |\n"]

  for (let index = 0; index < 300; index++) tableDeltas.push(`| ${index} | ${words(3, index)} |\n`)

  // G. Open code fence streamed across deltas.
  const codeDeltas: string[] = ["```ts\n"]

  for (let index = 0; index < 400; index++) codeDeltas.push(`const value${index} = ${index}\n`)

  return [
    {
      name: "many-paragraph-deltas",
      description: "200 short paragraphs, each a delta with a blank-line boundary",
      deltas: manyParagraphs,
    },
    {
      name: "one-long-paragraph",
      description: "one boundary-less paragraph, one word per delta",
      deltas: oneParagraph,
    },
    {
      name: "completed-head-live-tail",
      description: "40 completed paragraphs then a growing 500-word tail",
      prefix: completedHead,
      deltas: liveTail,
    },
    {
      name: "mixed-long-response",
      description: "representative mixed markdown streamed in 8-char chunks",
      deltas: mixedDeltas,
    },
    { name: "growing-list", description: "300 list items appended", deltas: listDeltas },
    { name: "growing-table", description: "300 table rows appended", deltas: tableDeltas },
    { name: "open-code-fence", description: "open code fence streamed 400 lines", deltas: codeDeltas },
  ]
}

function chunk(text: string, size: number) {
  const out: string[] = []

  for (let index = 0; index < text.length; index += size) out.push(text.slice(index, index + size))

  return out
}

type Rep = {
  totalMs: number
  durationsMs: number[]
  updates: number
  scannedChars: number
  // Streaming may hold a trailing bare marker (`- `, `1. `) or setext candidate
  // until its first content character arrives. The held suffix is not yet part
  // of any block, so the partition is a prefix rather than an exact match.
  heldTails: number
  partitionMismatches: number
}

function percentile(sorted: number[], p: number) {
  if (sorted.length === 0) return 0
  const index = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))

  return sorted[index]!
}

function execute(workload: Workload): Rep {
  let projection: Projection | undefined
  let text = workload.prefix ?? ""

  if (workload.prefix) projection = project(undefined, text, true)

  const durationsMs: number[] = []
  let totalNs = 0

  const startUpdates = updates
  const startChars = scannedChars
  let heldTails = 0
  let partitionMismatches = 0

  for (const delta of workload.deltas) {
    text += delta
    const before = Bun.nanoseconds()
    projection = project(projection, text, true)
    const after = Bun.nanoseconds()
    durationsMs.push((after - before) / 1e6)
    totalNs += after - before

    // The partition contract: blocks must reconstruct the current text, except
    // for a trailing marker the stream holds back until its first content
    // character arrives. Count real corruption separately from held tails, and
    // keep the check out of the timed region.
    const joined = projection.blocks.map((block) => block.raw).join("")

    if (joined === text) continue

    if (text.startsWith(joined)) heldTails++
    else partitionMismatches++
  }

  const totalMs = totalNs / 1e6
  const calls = updates - startUpdates
  const chars = scannedChars - startChars

  return { totalMs, durationsMs, updates: calls, scannedChars: chars, heldTails, partitionMismatches }
}

function run(workload: Workload, reps: number) {
  // Warm up the JIT and the lexer with a full pass before measuring.
  execute(workload)

  const samples: Rep[] = []

  for (let index = 0; index < reps; index++) samples.push(execute(workload))

  const totals = samples.map((sample) => sample.totalMs).sort((a, b) => a - b)
  const allDurations = samples.flatMap((sample) => sample.durationsMs).sort((a, b) => a - b)
  const updatesSample = samples.map((sample) => sample.updates)
  const scannedCharsSample = samples.map((sample) => sample.scannedChars)
  const heldTailsSample = samples.map((sample) => sample.heldTails)
  const partitionMismatchesSample = samples.map((sample) => sample.partitionMismatches)

  return {
    name: workload.name,
    description: workload.description,
    deltas: workload.deltas.length,
    finalChars: (workload.prefix?.length ?? 0) + workload.deltas.reduce((sum, delta) => sum + delta.length, 0),
    reps: samples.length,
    totalMs: { median: percentile(totals, 50), min: totals[0] ?? 0, max: totals.at(-1) ?? 0 },
    perUpdateMs: {
      median: percentile(allDurations, 50),
      p95: percentile(allDurations, 95),
      p99: percentile(allDurations, 99),
      max: allDurations.at(-1) ?? 0,
    },
    scanner: {
      updates: updatesSample,
      charsScanned: scannedCharsSample,
      updatesTotal: updatesSample.reduce((sum, value) => sum + value, 0),
    },
    heldTails: heldTailsSample,
    partitionMismatches: partitionMismatchesSample,
  }
}

const outputPath = process.argv[2]

const reps = Number(process.argv[3] ?? 5)

const workloads = makeWorkloads()

const results = workloads.map((workload) => run(workload, reps))

const report = {
  generator: "packages/session-ui/performance/markdown-stream/project.bench.ts",
  bun: Bun.version,
  reps,
  workloads: results,
}

console.log(JSON.stringify(report, null, 2))

if (outputPath) await Bun.write(outputPath, JSON.stringify(report, null, 2))
