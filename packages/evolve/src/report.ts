import type { RunResult } from "./types.ts"

function pct(n: number): string {
  return `${Math.round(n * 100)}%`
}

function num(n: number): string {
  return n.toFixed(3)
}

/** Render a human-readable markdown report of an evolution run. */
export function renderReport(run: RunResult): string {
  const lines: string[] = []
  lines.push(`# Evolution report: ${run.skillName}`)
  lines.push("")

  const b = run.baseline.objectives
  const best = run.best.evaluation.objectives
  lines.push(`- Outcome: ${run.improvedFromBaseline ? "✅ improved" : "➖ no improvement over baseline"}`)
  lines.push(`- Baseline score: ${num(b.score)} (pass ${pct(b.passRate)}, ${b.sizeBytes} bytes)`)
  lines.push(
    `- Best score: ${num(best.score)} (pass ${pct(best.passRate)}, ${best.sizeBytes} bytes) — candidate \`${run.best.candidate.id}\``,
  )
  if (run.best.candidate.rationale) lines.push(`- Rationale: ${run.best.candidate.rationale}`)
  lines.push("")

  lines.push("## Generations")
  lines.push("")
  lines.push("| Gen | Proposed | Frontier | Best id | Best score | Pass | Bytes |")
  lines.push("| --- | --- | --- | --- | --- | --- | --- |")
  for (const g of run.generations) {
    const bestEval = g.evaluated.find((e) => e.candidate.id === g.best)?.evaluation.objectives
    lines.push(
      `| ${g.generation} | ${g.evaluated.length} | ${g.frontier.length} | ${
        g.best || "—"
      } | ${bestEval ? num(bestEval.score) : "—"} | ${bestEval ? pct(bestEval.passRate) : "—"} | ${
        bestEval ? bestEval.sizeBytes : "—"
      } |`,
    )
  }
  lines.push("")

  lines.push("## Per-case scores (best candidate)")
  lines.push("")
  lines.push("| Case | Score | Detail |")
  lines.push("| --- | --- | --- |")
  for (const c of run.best.evaluation.cases) {
    lines.push(`| ${c.caseId} | ${num(c.score)} | ${c.detail ?? ""} |`)
  }
  lines.push("")

  return lines.join("\n")
}
