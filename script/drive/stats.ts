import { Effect } from "effect"
import { OpenCodeDriver } from "opencode-drive"

const label = process.env.DEMO_LABEL ?? "AFTER"

// Use an independent copy of the same fixture-stats.ts database for each run.
// OPENCODE_DRIVE_DB selects the fixture; OPENCODE_DEV selects the revision.
// No simulated provider response or artificial request delay is used.
export default OpenCodeDriver.use(
  {
    opencode: { dev: process.env.OPENCODE_DEV ?? process.cwd(), compatibility: "required" },
    keepArtifacts: true,
    tui: { recording: true, viewport: { cols: 80, rows: 32 } },
    config: { autoupdate: false, username: "Demo" },
    tuiConfig: { theme: { name: "opencode", mode: "dark" }, animations: false, tabs: { enabled: false } },
    project: {
      git: true,
      files: { "README.md": "# Usage statistics demo\nSynthetic history, real statistics query.\n" },
    },
  },
  ({ ui, tui }) =>
    Effect.gen(function* () {
      const recording = tui.recording
      if (!recording) return yield* Effect.fail(new Error("Recording required"))
      yield* ui.type("/stats")
      yield* ui.waitFor("Usage statistics")
      yield* Effect.sleep(500)
      yield* recording.mark(`${label}: open /stats | synthetic history, real query`)
      const started = performance.now()
      yield* ui.enter()
      yield* ui.waitFor("TOKENS", { timeout: 120_000, interval: 50 })
      const elapsed = performance.now() - started
      yield* recording.mark(`${label}: stats visible in ${(elapsed / 1000).toFixed(2)}s`)
      console.log(
        JSON.stringify({ label, visibleMs: elapsed, screenshot: yield* ui.screenshot(`${label.toLowerCase()}-stats`) }),
      )
      yield* Effect.sleep(3000)
      return console.log("video:", yield* recording.finish())
    }),
)
