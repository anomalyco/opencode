import { benchmark } from "../benchmark"
import { openComposerSession } from "./composer-session"
import {
  buildFixtureText,
  measureComposerPaste,
  measureComposerTyping,
  median,
  percentile,
  type ComposerPasteFixture,
} from "./composer-paste-probe"

const keystrokes = Number(process.env.OPENCODE_TYPING_KEYSTROKES ?? 20)

const fixtures: ComposerPasteFixture[] = [
  { label: "64KiB-multiline", chars: 64 * 1024, lines: 800 },
  { label: "100KiB-log", chars: 100 * 1024, lines: 1200 },
]

for (const composer of ["v2", "legacy"] as const) {
  for (const fixture of fixtures) {
    benchmark(`composer typing after paste ${composer} ${fixture.label}`, async ({ page, report }) => {
      benchmark.setTimeout(5 * 60_000)
      const selector = await openComposerSession(page, composer === "v2")
      await measureComposerPaste(page, selector, buildFixtureText(fixture))

      const samples = await measureComposerTyping(page, selector, keystrokes)
      const sync = samples.map((sample) => sample.syncMs)
      const settle = samples.map((sample) => sample.settleMs)
      report(
        {
          keystrokes: samples.length,
          syncMedianMs: median(sync),
          syncP95Ms: percentile(sync, 0.95),
          syncMaxMs: Math.max(...sync),
          settleMedianMs: median(settle),
          settleP95Ms: percentile(settle, 0.95),
        },
        { composer, fixture: fixture.label, chars: fixture.chars, lines: fixture.lines },
      )
    })
  }
}
