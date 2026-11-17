/** Benchmark report renderer (spec §7.6): bench/reports/rollover-benchmark.md.
 * Measured values only; estimates and not-run scenarios are labeled as such. */
import { mkdirSync, writeFileSync } from "node:fs"
import path from "node:path"
import { SCENARIO_IDS, type ScenarioResult } from "./runner"

export interface BenchMeta {
  opencodeVersion: string
  forkCommit: string
  model: string
  hardware: string
  configSummary: string
  generatedAt: string
}

export function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)
  return sorted[Math.max(0, idx)]
}

function n(x: number | undefined | null): string {
  return typeof x === "number" ? x.toLocaleString("en-US") : "—"
}

function resultTable(results: ScenarioResult[], ran: Set<string>): string {
  const rows = SCENARIO_IDS.map((id) => {
    const r = results.find((x) => x.scenario === id && !x.error)
    if (!ran.has(id) || !r) return `| ${id} | not run | — | — | — | — | — | — | — | — | — |`
    const red = r.contextReductions.length > 0
      ? r.contextReductions.map((c) => `${Math.round(((c.before - c.after) / c.before) * 100)}%`).join(", ")
      : "—"
    return `| ${id} | ${r.rollovers.ok} / ${r.rollovers.deferred} / ${r.rollovers.failed} | ${n(r.tokens.input)} | ${n(r.tokens.output)} | ${n(r.peakContextTokens)} | ${r.llmCalls} | ${n(r.extractionMs)} | ${n(r.consolidationMs)} | ${red} | ${r.cost === null ? "null (unpriced)" : `$${r.cost.toFixed(4)}`} | ${r.epochs} |`
  })
  return [
    "| Scenario | rollovers ok/deferred/failed | input tok | output tok | peak ctx tok | LLM calls | extraction ms | consolidation ms | ctx reduction | cost | epochs |",
    "|---|---|---|---|---|---|---|---|---|---|---|",
    ...rows,
  ].join("\n")
}

export function renderReport(meta: BenchMeta, results: ScenarioResult[], retentionMd = "Retention evaluation pending (Task 21)."): string {
  const ran = new Set(results.filter((r) => r.ok).map((r) => r.scenario))
  const baseline = results.filter((r) => r.mode === "baseline")
  const experimental = results.filter((r) => r.mode === "experimental")

  const lat = experimental.flatMap((r) => r.swapLatenciesMs)
  const latSection = lat.length > 0
    ? `p50 ${percentile(lat, 50).toFixed(1)} ms · p95 ${percentile(lat, 95).toFixed(1)} ms · max ${Math.max(...lat).toFixed(1)} ms (n=${lat.length}, measured)`
    : "no swaps observed"

  const cumulative = (rs: ScenarioResult[]) => rs.reduce((acc, r) => acc + r.tokens.input, 0)
  const expInput = cumulative(experimental)
  const baseInput = cumulative(baseline)
  let savings: string
  if (baseInput > 0 && expInput > 0) {
    const pct = ((baseInput - expInput) / baseInput) * 100
    savings = pct >= 0
      ? `${pct.toFixed(1)}% lower cumulative input (measured, summed over scenarios run in both modes)`
      : `${Math.abs(pct).toFixed(1)}% HIGHER cumulative input (measured): for these short scripted scenarios the extraction requests + render prepend cost more than the truncation saves — the mock payload estimate also counts system/tool scaffolding identically on both sides. Cumulative savings are expected to turn positive only for conversations long enough that truncation outweighs extraction overhead; the honest per-swap signal is the ctx-reduction column.`
  } else {
    savings = "— (needs baseline+experimental runs)"
  }

  const notRun = SCENARIO_IDS.filter((id) => !ran.has(id))
  const failed = results.filter((r) => r.error)

  return `# Rollover Benchmark Report

Generated: ${meta.generatedAt}

## Environment (measured)
- OpenCode: ${meta.opencodeVersion} (fork commit ${meta.forkCommit})
- Model: ${meta.model} (local mock LLM, scripted responses; input tokens derived from actual payload size)
- Hardware: ${meta.hardware}
- Config: ${meta.configSummary}

## Datasets
Spec §7.2 scenarios B1–B10 (bench/seed, bench/prompts, bench/hidden). Ran: ${ran.size ? [...ran].join(", ") : "none"}. Not run: ${notRun.length ? notRun.join(", ") : "none"} — no numbers are invented for scenarios that did not run.

## Baseline (plugin off)
${resultTable(baseline, ran)}

## Experimental (plugin auto)
${resultTable(experimental, ran)}

## Context savings (spec §7.4)
- ${savings}
- Immediate reduction at each swap: per-scenario "ctx reduction" column above (measured from swap metrics tokensBefore→tokensAfter).

## Cost
${experimental.every((r) => r.cost === null) ? "null for every scenario — the mock model has no price entry (pricing.json); spec §7.6 forbids inventing prices." : "See cost column above."}

## Swap latency (spec §6)
${latSection}

## Information retention (spec §7.5)
${retentionMd}

## Failed scenarios
${failed.length ? failed.map((r) => `- ${r.scenario} (${r.mode}): ${r.error}`).join("\n") : "none"}

## Limitations
- Mock-LLM usage: input tokens estimated from payload size (chars/4), cache values scripted 0 under autoUsage — absolute numbers approximate real provider accounting; baseline-vs-experimental comparisons remain valid because both sides use the same estimator.
- Extraction/consolidation answers are scripted; retention quality reflects the scripted extraction fidelity, not a production model.
- Scenarios marked "requires runtime evidence" in bench/hidden are env-dependent (wake-up shape, concurrency timing, restart behavior).
`
}

export function writeReport(meta: BenchMeta, results: ScenarioResult[], outPath: string, retentionMd?: string): void {
  mkdirSync(path.dirname(outPath), { recursive: true })
  writeFileSync(outPath, renderReport(meta, results, retentionMd))
}
