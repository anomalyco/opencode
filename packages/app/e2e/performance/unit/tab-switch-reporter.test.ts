import { expect, spyOn, test } from "bun:test"
import type { FullConfig, Suite, TestCase, TestResult } from "@playwright/test/reporter"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import TabSwitchReporter from "../tab-switch-reporter"

test("summarizes each scenario and saves complete records in the configured output directory", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "tab-switch-reporter-"))
  const output = path.join(root, "configured-output")
  const log = spyOn(console, "log").mockImplementation(() => {})
  try {
    const reporter = new TabSwitchReporter()
    const cases = Array.from(
      { length: 23 },
      (_, index) => ({ id: String(index), title: index < 20 ? "cold" : "warm" }) as TestCase,
    )
    const records = cases.map((_, index) => {
      const first = index < 20 ? 20 - index : [40, 0, 20][index - 20]
      return JSON.stringify({
        status: "passed",
        metrics: {
          firstCorrectObservedMs: first,
          stableObservedMs: first * 2,
          samples: [{ observedAtMs: first, destination: ["answer"], source: [] }],
        },
        extra: { preserved: "\u03b1" },
      })
    })
    reporter.onBegin({ projects: [{ outputDir: output }] } as FullConfig, { allTests: () => cases } as Suite)
    cases.forEach((item, index) => {
      const bytes = Buffer.from(`BENCHMARK ${records[index]}\r\n`)
      const split = bytes.indexOf(Buffer.from("\u03b1")) + 1
      reporter.onTestEnd(item, {
        status: "passed",
        stdout:
          index === 0
            ? [bytes.subarray(0, split), bytes.subarray(split)]
            : ["other output\nBENCHMARK_PAGE {}\nBENCH", "MARK ", records[index], "\n"],
      } as TestResult)
    })
    await reporter.onEnd({ status: "passed", startTime: new Date(0), duration: 0 })

    expect(await readFile(path.join(output, "tab-switch-benchmark.jsonl"), "utf8")).toBe(`${records.join("\n")}\n`)
    const summary = log.mock.calls.map((call) => call.join(" ")).join("\n")
    expect(summary).toContain("cold\n  Tests: passed=20; unrun=0")
    expect(summary).toContain("warm\n  Tests: passed=3; unrun=0")
    expect(summary).toContain("firstCorrectObservedMs: n=20, median=10.50 ms, p95=19.00 ms")
    expect(summary).toContain("stableObservedMs: n=20, median=21.00 ms, p95=38.00 ms")
    expect(summary).toContain("firstCorrectObservedMs: n=3, median=20.00 ms, p95=40.00 ms")
    expect(summary).toContain("stableObservedMs: n=3, median=40.00 ms, p95=80.00 ms")
  } finally {
    log.mockRestore()
    await rm(root, { recursive: true, force: true })
  }
})

test("reports failures, missing records, and invalid metrics without discarding raw data", async () => {
  const output = await mkdtemp(path.join(os.tmpdir(), "tab-switch-reporter-"))
  const log = spyOn(console, "log").mockImplementation(() => {})
  try {
    const reporter = new TabSwitchReporter()
    const entries = [
      {
        status: "passed",
        raw: '{"status":"passed","metrics":{"firstCorrectObservedMs":12,"stableObservedMs":24}}',
      },
      {
        status: "failed",
        raw: '{"status":"passed","metrics":{"firstCorrectObservedMs":900,"stableObservedMs":950}}',
      },
      {
        status: "passed",
        raw: '{"status":"failed","metrics":{"firstCorrectObservedMs":900,"stableObservedMs":950}}',
      },
      { status: "timedOut", raw: '{"status":"failed","metrics":null,"error":"Benchmark did not report metrics"}' },
      {
        status: "passed",
        raw: '{"status":"passed","metrics":{"firstCorrectObservedMs":null,"stableObservedMs":40}}',
      },
      { status: "failed", raw: '{"status":' },
      { status: "skipped", raw: undefined },
    ] as const
    const cases = Array.from(
      { length: entries.length + 2 },
      (_, index) => ({ id: String(index), title: index <= entries.length ? "cold" : "empty" }) as TestCase,
    )
    reporter.onBegin({ projects: [{ outputDir: output }] } as FullConfig, { allTests: () => cases } as Suite)
    entries.forEach((entry, index) => {
      reporter.onTestEnd(cases[index], {
        status: entry.status,
        stdout: entry.raw === undefined ? [] : [`BENCHMARK ${entry.raw}\n`],
      } as TestResult)
    })
    await reporter.onEnd({ status: "interrupted", startTime: new Date(0), duration: 0 })

    expect(await readFile(path.join(output, "tab-switch-benchmark.jsonl"), "utf8")).toBe(
      entries.flatMap((entry) => (entry.raw === undefined ? [] : [`${entry.raw}\n`])).join(""),
    )
    const summary = log.mock.calls.map((call) => call.join(" ")).join("\n")
    expect(summary).toContain("Tab-switch benchmark: interrupted")
    expect(summary).toContain("Tests: passed=3, failed=2, timedOut=1, skipped=1; unrun=1")
    expect(summary).toContain("Records: passed=3, failed=2, invalid JSON=1; missing=2; excluded=5; invalid metrics=1")
    expect(summary).toContain("firstCorrectObservedMs: n=1, median=12.00 ms, p95=12.00 ms")
    expect(summary).toContain("stableObservedMs: n=1, median=24.00 ms, p95=24.00 ms")
    expect(summary).toContain("empty\n  Tests: none; unrun=1")
    expect(summary).toContain("Records: none; missing=1; excluded=0; invalid metrics=0")
    expect(summary).toContain("firstCorrectObservedMs: n=0, median=n/a, p95=n/a")
    expect(summary).toContain("stableObservedMs: n=0, median=n/a, p95=n/a")
  } finally {
    log.mockRestore()
    await rm(output, { recursive: true, force: true })
  }
})
