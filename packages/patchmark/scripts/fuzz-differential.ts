// Differential fuzzing: patchmark one-shot HTML vs commonmark.js (core) and micromark + GFM (gfm: true).
// Usage: bun scripts/fuzz-differential.ts [coreCases=100000] [gfmCases=30000] [seed=1]
import { generate, mutate, normalizeHtml, patchmark, referenceCore, referenceGfm, rng } from "../test/fuzz"
import { isKnownGfmDivergence } from "../test/fuzz-known"

const coreCases = Number(process.argv[2] ?? 100_000)
const gfmCases = Number(process.argv[3] ?? 30_000)
const seed = Number(process.argv[4] ?? 1)
const r = rng(seed)

let coreDiffs = 0
const t0 = performance.now()

for (let i = 0; i < coreCases; i++) {
  const md = r() < 0.6 ? generate(r, false) : mutate(r)
  const want = referenceCore(md)
  const got = patchmark(md, false)

  if (got !== want) {
    coreDiffs++

    if (coreDiffs <= 15)
      console.log(`CORE DIFF #${i} ${JSON.stringify(md)}\n  got  ${JSON.stringify(got)}\n  want ${JSON.stringify(want)}`)
  }
}

const t1 = performance.now()

let gfmDiffs = 0
let gfmKnown = 0

for (let i = 0; i < gfmCases; i++) {
  const md = r() < 0.7 ? generate(r, true) : mutate(r)
  const want = normalizeHtml(referenceGfm(md))
  const got = normalizeHtml(patchmark(md, true))

  if (got !== want) {
    if (isKnownGfmDivergence(md, got, want)) {
      gfmKnown++
      continue
    }

    gfmDiffs++

    if (gfmDiffs <= 15)
      console.log(`GFM DIFF #${i} ${JSON.stringify(md)}\n  got  ${JSON.stringify(got)}\n  want ${JSON.stringify(want)}`)
  }
}

const t2 = performance.now()

console.log(`Core CommonMark: ${coreCases} cases in ${((t1 - t0) / 1000).toFixed(1)}s — ${coreDiffs} diffs`)
console.log(
  `GFM: ${gfmCases} cases in ${((t2 - t1) / 1000).toFixed(1)}s — ${gfmDiffs} unexpected diffs (${gfmKnown} known narrow divergences)`,
)

if (coreDiffs > 0 || gfmDiffs > 0) process.exit(1)
