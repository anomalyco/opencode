import { benchmark, expect } from "../benchmark"
import { openComposerSession } from "./composer-session"
import {
  buildFixtureText,
  measureComposerPaste,
  median,
  percentile,
  type ComposerPasteFixture,
  type ComposerPasteSample,
} from "./composer-paste-probe"

const iterations = Number(process.env.OPENCODE_PASTE_ITERATIONS ?? 5)

const fixtures: ComposerPasteFixture[] = [
  { label: "5KiB-multiline", chars: 5 * 1024, lines: 60 },
  { label: "64KiB-multiline", chars: 64 * 1024, lines: 800 },
  { label: "100KiB-log", chars: 100 * 1024, lines: 1200 },
  { label: "256KiB-log", chars: 256 * 1024, lines: 3000 },
  { label: "1MiB-log", chars: 1024 * 1024, lines: 12000 },
  { label: "1MiB-single-line", chars: 1024 * 1024, lines: 1 },
  { label: "256KiB-crlf", chars: 256 * 1024, lines: 3000, crlf: true },
]

function summarize(samples: ComposerPasteSample[]) {
  const settle = samples.map((sample) => sample.settleMs)
  const dispatch = samples.map((sample) => sample.dispatchMs)
  const blocked = samples.map((sample) => sample.blockedMs)
  return {
    iterations: samples.length,
    chars: samples[0]?.chars ?? 0,
    dispatchMedianMs: median(dispatch),
    settleMedianMs: median(settle),
    settleP95Ms: percentile(settle, 0.95),
    settleMaxMs: Math.max(...settle),
    blockedMedianMs: median(blocked),
    longestTaskMaxMs: Math.max(...samples.map((sample) => sample.longestTaskMs)),
    editorElementsMax: Math.max(...samples.map((sample) => sample.editorElements)),
    lossless: samples.every((sample) => sample.lossless),
  }
}

// A composer that stalls the renderer never returns from its paste, so every fixture runs as
// its own test with its own page. One hung tier then costs only its own measurement instead
// of every tier queued behind it.
const FIXTURE_TIMEOUT_MS = 3 * 60_000

for (const composer of ["v2", "legacy"] as const) {
  for (const fixture of fixtures) {
    benchmark(`composer paste ${composer} ${fixture.label}`, async ({ page, report }) => {
      benchmark.setTimeout(FIXTURE_TIMEOUT_MS)
      const selector = await openComposerSession(page, composer === "v2")
      const text = buildFixtureText(fixture)

      const samples: ComposerPasteSample[] = []
      for (let index = 0; index < iterations; index += 1) {
        samples.push(await measureComposerPaste(page, selector, text))
        await page.evaluate((target) => {
          const editor = document.querySelector(target)
          if (!(editor instanceof HTMLElement)) return
          const range = document.createRange()
          range.selectNodeContents(editor)
          const selection = window.getSelection()
          selection?.removeAllRanges()
          selection?.addRange(range)
          document.execCommand("delete")
        }, selector)
        await page.waitForTimeout(150)
      }

      const summary = summarize(samples)
      report(summary, { composer, fixture: fixture.label, chars: fixture.chars, lines: fixture.lines })

      // Asserted after reporting so a lossy paste still leaves its measurements behind.
      expect(summary.lossless, `${composer} ${fixture.label} must round-trip losslessly`).toBe(true)
    })
  }
}
