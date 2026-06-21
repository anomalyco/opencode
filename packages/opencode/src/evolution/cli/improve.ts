import { EOL } from "os"
import { Effect } from "effect"
import { effectCmd } from "@/cli/effect-cmd"
import { suggest } from "@/evolution/evolution/improver"

export const ImproveCommand = effectCmd({
  command: "improve",
  describe: "[Sprint C] generate actionable suggestions from decision analysis report",
  instance: true,
  handler: Effect.fn("Cli.evolution.improve")(function* () {
    const { MetricsService } = yield* import("@/evolution/evolution/metrics")
    const { EvolutionAnalyzer } = yield* import("@/evolution/evolution/analyzer")
    const metrics = yield* MetricsService.Service
    const analyzer = yield* EvolutionAnalyzer.Service
    const snapshot = yield* metrics.snapshot()
    const report = yield* analyzer.analyze(snapshot)
    const suggestions = suggest(report)

    const isJson = process.argv.includes("--json")

    if (isJson) {
      process.stdout.write(JSON.stringify(suggestions, null, 2) + EOL)
      return
    }

    process.stdout.write(`${EOL}=== EF-AI Improvement Suggestions ===${EOL}`)
    process.stdout.write(`Generated: ${new Date(report.generatedAt).toISOString()}${EOL}`)
    process.stdout.write(`Suggestions: ${suggestions.length} found${EOL}`)
    process.stdout.write(EOL)

    if (suggestions.length === 0) {
      process.stdout.write("No actionable suggestions. Run `opencode evolution evaluate` to generate more data." + EOL)
      process.stdout.write(EOL)
      return
    }

    for (const s of suggestions) {
      process.stdout.write(`SUGGESTION ${s.suggestionId} [confidence: ${s.confidence}]${EOL}`)
      process.stdout.write(`Category: ${s.category}${EOL}`)
      if (s.targetField) process.stdout.write(`Target: ${s.targetField}${EOL}`)
      if (s.targetAgentId) process.stdout.write(`Target agent: ${s.targetAgentId}${EOL}`)
      process.stdout.write(EOL)
      if (s.currentValue != null) process.stdout.write(`Current value: ${s.currentValue}${EOL}`)
      if (s.suggestedValue != null) process.stdout.write(`Suggested value: ${s.suggestedValue}${EOL}`)
      process.stdout.write(EOL)
      process.stdout.write(`Rationale: ${s.rationale}${EOL}`)
      process.stdout.write(EOL)
      process.stdout.write(`Metric sources: ${s.metricSource.join(", ")}${EOL}`)
      process.stdout.write(EOL)
      process.stdout.write(`How to apply:${EOL}  ${s.howToApply}${EOL}`)
      process.stdout.write(EOL)
      process.stdout.write("---" + EOL)
      process.stdout.write(EOL)
    }

    process.stdout.write(`NOTE: ${suggestions.length} suggestion(s) generated.`)
    process.stdout.write(" Run `opencode evolution evaluate` regularly to improve suggestion quality." + EOL)
    process.stdout.write(EOL)
  }),
})
