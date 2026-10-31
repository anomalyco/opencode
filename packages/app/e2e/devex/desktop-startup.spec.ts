import { test } from "@playwright/test"
import {
  desktopBenchmarkContext,
  runDesktopStartup,
  summarizeDesktopStartup,
  type DesktopStartupSample,
} from "./desktop-startup"

test("opens a cold desktop on Home", async ({}, testInfo) => {
  test.setTimeout(15 * 60_000)
  const runs = Number(process.env.DESKTOP_STARTUP_RUNS ?? 5)

  if (!Number.isSafeInteger(runs) || runs < 1) throw new Error("DESKTOP_STARTUP_RUNS must be a positive integer")

  const context = await desktopBenchmarkContext(runs)
  const samples: DesktopStartupSample[] = []

  // Raw samples survive a failed run, for the runs that finished.
  const report = () =>
    testInfo.attach("desktop-startup.json", {
      body: JSON.stringify({
        context,
        samples,
        summary: samples.length ? summarizeDesktopStartup(samples) : undefined,
      }),
      contentType: "application/json",
    })

  for (let run = 1; run <= runs; run++) {
    samples.push(
      await runDesktopStartup(run, testInfo).catch(async (error) => {
        await report()
        throw error
      }),
    )
  }

  await report()
  console.log(JSON.stringify(summarizeDesktopStartup(samples).commandToHomeReadyMs))
})
