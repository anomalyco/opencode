import { EOL } from "os"
import { Effect } from "effect"
import { effectCmd } from "@/cli/effect-cmd"

export const AnalyzeCommand = effectCmd({
  command: "analyze",
  describe: "[Sprint B] analyze decision quality — failure patterns, advisor analysis, config health",
  instance: true,
  handler: Effect.fn("Cli.evolution.analyze")(function* () {
    const { MetricsService } = yield* import("@/evolution/evolution/metrics")
    const { EvolutionAnalyzer } = yield* import("@/evolution/evolution/analyzer")
    const metrics = yield* MetricsService.Service
    const analyzer = yield* EvolutionAnalyzer.Service
    const snapshot = yield* metrics.snapshot()
    const report = yield* analyzer.analyze(snapshot)

    const isJson = process.argv.includes("--json")

    if (isJson) {
      process.stdout.write(JSON.stringify(report, null, 2) + EOL)
      return
    }

    const fmtPct = (v: number | null, d = 1) => v != null ? `${(v * 100).toFixed(d)}%` : "N/A"
    const fmt = (v: number | null, d = 1) => v != null ? v.toFixed(d) : "N/A"

    process.stdout.write(`${EOL}=== EF-AI Decision Analysis Report ===${EOL}`)
    process.stdout.write(`Generated: ${new Date(report.generatedAt).toISOString()}${EOL}`)
    process.stdout.write(`Assessment: ${report.overallAssessment}${EOL}`)
    process.stdout.write(EOL)

    process.stdout.write(`FAILURE PATTERN: ${report.failurePattern.patternClassification}${EOL}`)
    if (report.failurePattern.dominantRejectionCode) {
      process.stdout.write(`  Dominant rejection: ${report.failurePattern.dominantRejectionCode} (${fmtPct(report.failurePattern.dominantRejectionRate)})${EOL}`)
    }

    process.stdout.write(EOL)
    process.stdout.write(`ADVISOR ANALYSIS:${EOL}`)
    process.stdout.write(`  Advisor execution rate: ${fmtPct(report.advisorAnalysis.advisorExecutionRate)}${EOL}`)
    process.stdout.write(`  Enrichment effect: ${report.advisorAnalysis.enrichmentEffect}${EOL}`)
    if (report.advisorAnalysis.underperformingAdvisors.length > 0) {
      process.stdout.write(`  Underperforming advisors:${EOL}`)
      for (const a of report.advisorAnalysis.underperformingAdvisors) {
        process.stdout.write(`    - ${a.agentId} (${a.contributionType}): ${a.executionCount} executions${EOL}`)
      }
    }

    process.stdout.write(EOL)
    process.stdout.write(`CONFIG HEALTH:${EOL}`)
    process.stdout.write(`  Threshold: ${report.configAnalysis.thresholdAssessment}${EOL}`)
    process.stdout.write(`  Budget: ${report.configAnalysis.budgetAssessment}${EOL}`)

    process.stdout.write(EOL)
    process.stdout.write(`TREND: ${report.usageTrend.trendDirection}${EOL}`)
    process.stdout.write(`  Data points: ${report.usageTrend.dataPoints}${EOL}`)

    process.stdout.write(EOL)
    process.stdout.write(`RATIONALE: ${report.assessmentRationale}${EOL}`)
    process.stdout.write(EOL)
  }),
})
