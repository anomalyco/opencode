import { EOL } from "os"
import { Effect } from "effect"
import { effectCmd, CliError } from "@/cli/effect-cmd"
import { MetricsService } from "@/evolution/evolution/metrics"
import { EvolutionStorageError } from "@/evolution/error"

export const MetricsCommand = effectCmd({
  command: "metrics",
  describe: "[Sprint A] show decision quality metrics from proposals and reconciliations",
  instance: true,
  handler: (_args: { "--"?: string[] | undefined }) =>
    Effect.gen(function* () {
      const svc = yield* MetricsService.Service
      const snapshot = yield* svc.snapshot()

      const isJson = process.argv.includes("--json")

      if (isJson) {
        process.stdout.write(JSON.stringify(snapshot, null, 2) + EOL)
        return
      }

      const pct = (v: number | null) => v != null ? `${(v * 100).toFixed(1)}%` : "N/A"
      const fmt = (v: number | null, d = 2) => v != null ? v.toFixed(d) : "N/A"

      process.stdout.write(`${EOL}=== Evolution Decision Metrics ===${EOL}`)
      process.stdout.write(`  Total Proposals:               ${snapshot.totalProposals ?? "N/A"}${EOL}`)
      process.stdout.write(`  Acceptance Rate:               ${pct(snapshot.acceptanceRate)}${EOL}`)
      process.stdout.write(`  Avg Time to Acceptance (ms):   ${fmt(snapshot.avgTimeToAcceptance, 0)}${EOL}`)
      process.stdout.write(`  Proposal Churn:                ${pct(snapshot.proposalChurn)}${EOL}`)
      process.stdout.write(`  Total Reconciliations:         ${snapshot.totalReconciliations ?? "N/A"}${EOL}`)
      process.stdout.write(`  Avg Confidence Score:          ${fmt(snapshot.avgConfidenceScore)}${EOL}`)
      process.stdout.write(`  Avg Participants/Reconcil:     ${fmt(snapshot.avgParticipantsPerReconciliation)}${EOL}`)
      process.stdout.write(`  Budget Utilization:            ${snapshot.budgetUtilization ?? "UNAVAILABLE"}${EOL}`)
      process.stdout.write(`  Diversity Index:               ${snapshot.diversityIndex ?? "UNAVAILABLE"}${EOL}`)
      process.stdout.write(EOL)
    }).pipe(Effect.catchCause((cause) => Effect.fail(new CliError({ message: "Metrics failed" })))),
})
