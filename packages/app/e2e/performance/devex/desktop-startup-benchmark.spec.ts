import { benchmark } from "../benchmark"
import {
  desktopBenchmarkContext,
  runDesktopStartup,
  summarizeDesktopStartup,
  type DesktopStartupSample,
} from "./desktop-startup"

benchmark.describe("devex: desktop startup", () => {
  benchmark("opens a cold desktop on Home", async ({ report }, testInfo) => {
    benchmark.setTimeout(15 * 60_000)
    const runs = Number(process.env.DESKTOP_STARTUP_RUNS ?? 5)
    if (!Number.isSafeInteger(runs) || runs < 1) throw new Error("DESKTOP_STARTUP_RUNS must be a positive integer")

    const samples: DesktopStartupSample[] = []
    const context = await desktopBenchmarkContext(runs)
    for (let run = 1; run <= runs; run++) {
      const sample = await runDesktopStartup(run, testInfo).catch((error) => {
        report(samples.length ? { samples, summary: summarizeDesktopStartup(samples) } : { samples }, context)
        throw error
      })
      samples.push(sample)
    }
    report({ samples, summary: summarizeDesktopStartup(samples) }, context)
  })
})
