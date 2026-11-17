/** Benchmark driver (plan Task 21, spec §7.3 matrix): runs the scenario set
 * against the fork-built binary, writes bench/reports/raw-*.json per run and
 * bench/reports/rollover-benchmark.md (§7.6 format).
 * Matrix: B1/B2/B4 baseline+experimental; B6/B7/B9 experimental only;
 * B8/B10 are NOT run (requires-runtime-evidence / concurrency timing) and are
 * labeled as such in the report — no numbers are invented for them. */
import { mkdirSync, writeFileSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { runScenario, loadHidden, type ScenarioId, type ScenarioResult } from "./runner"
import { evaluateRetention, type RetentionScore } from "./retention"
import { writeReport, type BenchMeta } from "./report"

const BOTH: ScenarioId[] = ["B1", "B2", "B4"]
const EXP_ONLY: ScenarioId[] = ["B6", "B7", "B9"]

function retentionTable(rows: Array<{ id: string; score: RetentionScore }>): string {
  if (rows.length === 0) return "no retention data collected"
  const lines = [
    "Per-scenario retention of expected facts after rollovers (experimental runs):",
    "",
    "| Scenario | recall | precision | F1 | critical omissions | wrong invalidations | unresolved open items | false claims |",
    "|---|---|---|---|---|---|---|---|",
    ...rows.map(({ id, score }) =>
      `| ${id} | ${score.recall === null ? "—" : score.recall.toFixed(2)} | ${score.precision === null ? "—" : score.precision.toFixed(2)} | ${score.f1 === null ? "—" : score.f1.toFixed(2)} | ${score.criticalOmissions.length ? score.criticalOmissions.join("; ") : "none"} | ${score.wrongInvalidations.length ? score.wrongInvalidations.join("; ") : "none"} | ${score.unresolvedOpenItems.length ? score.unresolvedOpenItems.join("; ") : "none"} | ${score.falseClaims.length ? score.falseClaims.join("; ") : "none"} |`,
    ),
    "",
    "Matching: normalized token-Jaccard ≥ 0.4 (record↔fact), normalized substring (render). B6 expects recall 0 for ledger retention — its extraction is scripted to fail; facts survive only in intact history.",
  ]
  return lines.join("\n")
}

async function main(): Promise<void> {
  const pkgRoot = path.resolve(import.meta.dir, "..")
  const reportsDir = path.join(pkgRoot, "bench", "reports")
  mkdirSync(reportsDir, { recursive: true })

  // --from-raw: re-render the report from existing raw-*.json artifacts
  // (retention + meta included) without re-running the benchmark.
  if (process.argv.includes("--from-raw")) {
    const bin = process.env.OPENCODE_BIN
    if (!bin) {
      console.error("OPENCODE_BIN is required (fork-built binary)")
      process.exit(1)
    }
    const results: ScenarioResult[] = []
    const retentionRows: Array<{ id: string; score: RetentionScore }> = []
    for (const f of [...BOTH, ...EXP_ONLY]) {
      const modes: Array<"baseline" | "experimental"> = BOTH.includes(f)
        ? ["baseline", "experimental"]
        : ["experimental"]
      for (const mode of modes) {
        const res = JSON.parse(await Bun.file(path.join(reportsDir, `raw-${f}-${mode}.json`)).text()) as ScenarioResult
        results.push(res)
        if (mode === "experimental" && res.ok && res.artifacts && res.rollovers.ok > 0) {
          retentionRows.push({ id: f, score: evaluateRetention(await loadHidden(f), res.artifacts) })
        }
      }
    }
    const meta0: BenchMeta = {
      opencodeVersion: "2.x fork build (packages/cli/dist/rollover-test)",
      forkCommit: Bun.spawnSync(["git", "rev-parse", "--short", "HEAD"], { cwd: path.resolve(pkgRoot, "../..") }).stdout.toString().trim(),
      model: "mockllm/test-model (local mock, autoUsage input = payload chars/4)",
      hardware: `${os.cpus()[0]?.model ?? "unknown"} · ${os.platform()} ${os.arch()}`,
      configSummary: "per-seed thresholds (B1: 100k = no swap; others: 1k = aggressive), tailN 0 (B1: 2), plugin mode auto",
      generatedAt: new Date().toISOString(),
    }
    writeReport(meta0, results, path.join(reportsDir, "rollover-benchmark.md"), retentionTable(retentionRows))
    console.log(`report re-rendered: ${path.join(reportsDir, "rollover-benchmark.md")}`)
    return
  }

  const bin = process.env.OPENCODE_BIN
  if (!bin) {
    console.error("OPENCODE_BIN is required (fork-built binary)")
    process.exit(1)
  }
  const root = path.join(process.env.TMPDIR ?? "/tmp", `opencode-rollover-bench-${process.pid}`)

  const forkCommit = Bun.spawnSync(["git", "rev-parse", "--short", "HEAD"], {
    cwd: path.resolve(pkgRoot, "../.."),
  }).stdout.toString().trim()
  const meta: BenchMeta = {
    opencodeVersion: "2.x fork build (packages/cli/dist/rollover-test)",
    forkCommit,
    model: "mockllm/test-model (local mock, autoUsage input = payload chars/4)",
    hardware: `${os.cpus()[0]?.model ?? "unknown"} · ${os.platform()} ${os.arch()}`,
    configSummary: "per-seed thresholds (B1: 100k = no swap; others: 1k = aggressive), tailN 0 (B1: 2), plugin mode auto",
    generatedAt: new Date().toISOString(),
  }

  const results: ScenarioResult[] = []
  const retentionRows: Array<{ id: string; score: RetentionScore }> = []

  for (const id of [...BOTH, ...EXP_ONLY]) {
    const modes: Array<"baseline" | "experimental"> = BOTH.includes(id)
      ? ["baseline", "experimental"]
      : ["experimental"]
    for (const mode of modes) {
      process.stdout.write(`running ${id} (${mode})... `)
      const res = await runScenario({ scenario: id, mode, sandboxDir: path.join(root, `${id}-${mode}`), bin })
      results.push(res)
      console.log(`ok=${res.ok} rollovers=${res.rollovers.ok}/${res.rollovers.deferred}/${res.rollovers.failed} epochs=${res.epochs} inputTok=${res.tokens.input}`)
      writeFileSync(
        path.join(reportsDir, `raw-${id}-${mode}.json`),
        JSON.stringify(res, null, 2) + "\n",
      )
      if (mode === "experimental" && res.ok && res.artifacts) {
        const hidden = await loadHidden(id)
        if (res.rollovers.ok > 0) {
          // Score only scenarios that actually rolled over: for no-swap runs
          // (B1 below threshold) and extraction-failure runs (B6, swaps always
          // deferred) the ledger is empty BY DESIGN — scoring them as recall 0
          // would misstate retention; their facts live in intact history.
          retentionRows.push({ id, score: evaluateRetention(hidden, res.artifacts) })
        }
      }
    }
  }

  writeReport(meta, results, path.join(reportsDir, "rollover-benchmark.md"), retentionTable(retentionRows))
  console.log(`\nreport: ${path.join(reportsDir, "rollover-benchmark.md")}`)
}

await main()
