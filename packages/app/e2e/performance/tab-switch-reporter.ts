import type { FullConfig, FullResult, Reporter, Suite, TestCase, TestResult } from "@playwright/test/reporter"
import { mkdir, writeFile } from "node:fs/promises"
import path from "node:path"

type BenchmarkRecord = {
  status?: string
  metrics?: { firstCorrectObservedMs?: unknown; stableObservedMs?: unknown } | null
}

export default class TabSwitchReporter implements Reporter {
  private output = ""
  private tests: TestCase[] = []
  private results: { test: TestCase; status: TestResult["status"]; records: string[] }[] = []

  onBegin(config: FullConfig, suite: Suite) {
    this.output = config.projects[0].outputDir
    this.tests = suite.allTests()
  }

  onTestEnd(test: TestCase, result: TestResult) {
    this.results.push({
      test,
      status: result.status,
      records: Buffer.concat(result.stdout.map((chunk) => (typeof chunk === "string" ? Buffer.from(chunk) : chunk)))
        .toString("utf8")
        .split(/\r?\n/)
        .filter((line) => line.startsWith("BENCHMARK "))
        .map((line) => line.slice("BENCHMARK ".length)),
    })
  }

  async onEnd(result: FullResult) {
    const file = path.join(this.output, "tab-switch-benchmark.jsonl")
    try {
      await mkdir(this.output, { recursive: true })
      await writeFile(file, this.results.flatMap((entry) => entry.records.map((raw) => `${raw}\n`)).join(""), "utf8")
    } catch (error) {
      console.error("Could not save tab-switch benchmark records:", error)
      return { status: "failed" as const }
    }

    console.log(`\nTab-switch benchmark: ${result.status}`)
    Array.from(new Set(this.tests.map((test) => test.title))).forEach((name) => {
      const results = this.results.filter((entry) => entry.test.title === name)
      const unrun = this.tests.filter(
        (test) => test.title === name && !results.some((entry) => entry.test.id === test.id),
      ).length
      const records = results.flatMap((entry) =>
        entry.records.map((raw) => {
          try {
            return { status: entry.status, record: JSON.parse(raw) as BenchmarkRecord | null }
          } catch {
            return { status: entry.status, record: { status: "invalid JSON", metrics: null } }
          }
        }),
      )
      const passed = records.filter((entry) => entry.status === "passed" && entry.record?.status === "passed")
      const valid = passed
        .map((entry) => ({
          firstCorrectObservedMs: entry.record?.metrics?.firstCorrectObservedMs,
          stableObservedMs: entry.record?.metrics?.stableObservedMs,
        }))
        .filter(
          (metrics): metrics is { firstCorrectObservedMs: number; stableObservedMs: number } =>
            typeof metrics.firstCorrectObservedMs === "number" &&
            Number.isFinite(metrics.firstCorrectObservedMs) &&
            typeof metrics.stableObservedMs === "number" &&
            Number.isFinite(metrics.stableObservedMs),
        )

      console.log(`\n${name}`)
      console.log(`  Tests: ${counts(results.map((entry) => entry.status))}; unrun=${unrun}`)
      console.log(
        `  Records: ${counts(records.map((entry) => entry.record?.status ?? "missing status"))}; ` +
          `missing=${results.filter((entry) => entry.records.length === 0).length + unrun}; ` +
          `excluded=${records.length - valid.length}; invalid metrics=${passed.length - valid.length}`,
      )
      ;(["firstCorrectObservedMs", "stableObservedMs"] as const).forEach((metric) => {
        const values = valid.map((entry) => entry[metric]).sort((a, b) => a - b)
        if (values.length === 0) {
          console.log(`  ${metric}: n=0, median=n/a, p95=n/a`)
          return
        }
        const median = (values[Math.floor((values.length - 1) / 2)] + values[Math.floor(values.length / 2)]) / 2
        const p95 = values[Math.ceil(values.length * 0.95) - 1]
        console.log(`  ${metric}: n=${values.length}, median=${median.toFixed(2)} ms, p95=${p95.toFixed(2)} ms`)
      })
    })
    console.log(`\nRaw BENCHMARK records: ${file}`)
  }
}

function counts(statuses: string[]) {
  return (
    Array.from(new Set(statuses))
      .map((status) => `${status}=${statuses.filter((value) => value === status).length}`)
      .join(", ") || "none"
  )
}
