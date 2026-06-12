#!/usr/bin/env bun
// Measures what the model receives from the read tool in text mode vs
// screenshot mode, on real files.
//
// Text side: the exact text-mode payload (numbered lines + envelope),
// tokenized with o200k_base — the GPT-5 family tokenizer. Anthropic's
// tokenizer is unpublished and counts code somewhat higher, so the measured
// savings are understated for Claude.
//
// Image side: the exact screenshot-mode text payload plus Anthropic's
// published visual-token formula, ceil(w/28) * ceil(h/28), applied to the
// actual rendered pages. This formula is exact, not an estimate.
//
//   bun script/read-screenshot-cost.ts [dir] [glob]
//
// Defaults to every TypeScript file under src/.

import { Effect } from "effect"
import path from "path"
import { encode } from "gpt-tokenizer/encoding/o200k_base"
import { MIN_LINES, render } from "../src/tool/read-screenshot/read-screenshot"

const LIMIT = 2000
const MAX_BYTES = 50 * 1024
const root = path.resolve(process.argv[2] ?? path.join(import.meta.dir, "../src"))
const pattern = process.argv[3] ?? "**/*.ts"

const files: string[] = []
for await (const file of new Bun.Glob(pattern).scan({ cwd: root, absolute: true })) {
  files.push(file)
}
files.sort()

interface Result {
  file: string
  lines: number
  pages: number
  text: number
  image: number
}

const results: Result[] = []
let skipped = 0
for (const file of files) {
  const content = await Bun.file(file).text()
  const lines = content.split("\n")
  if (lines.at(-1) === "") lines.pop()
  if (lines.length === 0) continue
  if (lines.length > LIMIT || content.length > MAX_BYTES) {
    skipped += 1
    continue
  }
  const relative = path.relative(root, file)
  const status = `(End of file - total ${lines.length} lines)`
  const envelope = [`<path>${file}</path>`, `<type>file</type>`, "<content>\n"].join("\n")

  // Mirrors the read tool's text-mode payload byte for byte.
  const text = envelope + lines.map((line, index) => `${index + 1}: ${line}`).join("\n") + `\n\n${status}\n</content>`

  const pages = await Effect.runPromise(
    render({ path: relative, filepath: file, lines, offset: 1, total: lines.length }),
  )
  // Mirrors the read tool's screenshot-mode payload byte for byte.
  const note =
    envelope +
    `(Content attached as ${pages.length} screenshot${pages.length === 1 ? "" : "s"}, lines 1-${lines.length}; rows marked ↪ continue the previous line.)` +
    `\n\n${status}\n</content>`
  const visual = pages.reduce((sum, page) => {
    const buffer = Buffer.from(page.url.slice("data:image/png;base64,".length), "base64")
    return sum + Math.ceil(buffer.readUInt32BE(16) / 28) * Math.ceil(buffer.readUInt32BE(20) / 28)
  }, 0)

  results.push({
    file: relative,
    lines: lines.length,
    pages: pages.length,
    text: encode(text).length,
    image: encode(note).length + visual,
  })
}

const pad = (value: string | number, width: number) => String(value).padStart(width)
console.log(`${"file".padEnd(64)}${pad("lines", 7)}${pad("pages", 6)}${pad("text", 8)}${pad("image", 8)}${pad("ratio", 7)}`)
for (const row of results) {
  const name = row.file.length > 62 ? `…${row.file.slice(-61)}` : row.file
  console.log(
    `${name.padEnd(64)}${pad(row.lines, 7)}${pad(row.pages, 6)}${pad(row.text, 8)}${pad(row.image, 8)}${pad((row.image / row.text).toFixed(2), 7)}`,
  )
}

const total = results.reduce(
  (sum, row) => ({ lines: sum.lines + row.lines, text: sum.text + row.text, image: sum.image + row.image }),
  { lines: 0, text: 0, image: 0 },
)
const ratios = results.map((row) => row.image / row.text).sort((a, b) => a - b)
console.log()
console.log(`files: ${results.length} (skipped ${skipped} over read caps), lines: ${total.lines}`)
console.log(`text tokens:  ${total.text} (${(total.text / total.lines).toFixed(1)}/line)`)
console.log(`image tokens: ${total.image} (${(total.image / total.lines).toFixed(1)}/line)`)
console.log(
  `image/text ratio: ${(total.image / total.text).toFixed(2)} overall — median ${ratios[Math.floor(ratios.length / 2)]?.toFixed(2)}, best ${ratios[0]?.toFixed(2)}, worst ${ratios.at(-1)?.toFixed(2)}`,
)
console.log(`savings: ${(100 * (1 - total.image / total.text)).toFixed(1)}%`)

// What the shipped policy actually sends: text below MIN_LINES, images above.
const policy = results.reduce(
  (sum, row) => sum + (row.lines >= MIN_LINES ? row.image : row.text),
  0,
)
console.log(
  `with MIN_LINES=${MIN_LINES} gate: ${policy} tokens, ratio ${(policy / total.text).toFixed(2)}, savings ${(100 * (1 - policy / total.text)).toFixed(1)}%`,
)
