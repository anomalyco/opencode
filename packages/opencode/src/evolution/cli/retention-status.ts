import { EOL } from "os"
import { Effect } from "effect"
import { effectCmd } from "@/cli/effect-cmd"

export const RetentionStatusCommand = effectCmd({
  command: "retention-status",
  describe: "[Sprint E] show ProposalStore retention analysis — volume, growth projection, latency benchmark, and binary recommendation",
  instance: true,
  handler: Effect.fn("Cli.evolution.retention-status")(function* () {
    const { RetentionService } = yield* import("@/evolution/evolution/retention")
    const svc = yield* RetentionService.Service
    const analysis = yield* svc.analyze()

    const isJson = process.argv.includes("--json")

    if (isJson) {
      process.stdout.write(JSON.stringify(analysis, null, 2) + EOL)
      return
    }

    const mb = (v: number) => (v / 1_000_000).toFixed(1)
    const fmt = (v: number | null) => v != null ? v.toLocaleString() : "N/A"
    const pct = (v: number | null) => v != null ? v.toFixed(0) : "N/A"

    process.stdout.write(`${EOL}=== Evolution Retention Analysis ===${EOL}`)
    process.stdout.write(`${EOL}── Volume Metrics ──${EOL}`)
    process.stdout.write(`  Total Proposals:              ${fmt(analysis.totalProposals)}${EOL}`)
    process.stdout.write(`  Total Reconciliation Logs:    ${fmt(analysis.totalReconciliationLogs)}${EOL}`)
    process.stdout.write(`  Total Storage:                ${mb(analysis.totalStorageBytes)} MB (${fmt(analysis.totalStorageBytes)} bytes)${EOL}`)
    process.stdout.write(`${EOL}── Growth Projection ──${EOL}`)
    process.stdout.write(`  Proposals Per Session:        ${fmt(analysis.proposalsPerSession)}${EOL}`)
    process.stdout.write(`  Projected @30 Sessions:        ${fmt(analysis.projectedProposalsIn30Sessions)}${EOL}`)
    process.stdout.write(`  Projected @100 Sessions:       ${fmt(analysis.projectedProposalsIn100Sessions)}${EOL}`)
    process.stdout.write(`${EOL}── Latency Benchmark (listByStatus) ──${EOL}`)
    process.stdout.write(`  p50:                          ${analysis.listByStatusLatencyMs.p50 != null ? `${analysis.listByStatusLatencyMs.p50.toFixed(1)}ms` : "N/A"}${EOL}`)
    process.stdout.write(`  p95:                          ${analysis.listByStatusLatencyMs.p95 != null ? `${analysis.listByStatusLatencyMs.p95.toFixed(1)}ms` : "N/A"}${EOL}`)
    process.stdout.write(`  p99:                          ${analysis.listByStatusLatencyMs.p99 != null ? `${analysis.listByStatusLatencyMs.p99.toFixed(1)}ms` : "N/A"}${EOL}`)
    process.stdout.write(`${EOL}── Recommendation ──${EOL}`)
    process.stdout.write(`  Decision:                     ${analysis.recommendation}${EOL}`)
    process.stdout.write(`  Rationale:                    ${analysis.recommendationRationale}${EOL}`)
    process.stdout.write(EOL)
  }),
})
