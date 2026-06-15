import { Effect } from "effect"
import { sql } from "drizzle-orm"
import { effectCmd } from "../effect-cmd"
import { Session } from "@/session/session"
import { Database } from "@opencode-ai/core/database/database"
import { SessionTable } from "@opencode-ai/core/session/sql"

interface PhaseMetrics {
  sessionID: string
  agent: string | undefined
  durationMs: number
  cost: number
  tokens: {
    input: number
    output: number
    reasoning: number
    cacheRead: number
    cacheWrite: number
  }
}

interface LoopRunMetrics {
  orchestratorSessionID: string
  orchestratorCost: number
  orchestratorTokens: {
    input: number
    output: number
    reasoning: number
    cacheRead: number
    cacheWrite: number
  }
  orchestratorDurationMs: number
  phases: PhaseMetrics[]
  totalDurationMs: number
  totalCost: number
  totalTokens: {
    input: number
    output: number
    reasoning: number
    cacheRead: number
    cacheWrite: number
  }
  startedAt: Date | null
  endedAt: Date | null
}

interface BenchmarkReport {
  runs: LoopRunMetrics[]
  summary: {
    totalRuns: number
    avgDurationMs: number
    avgCost: number
    avgTokensPerRun: number
    avgPhasesPerRun: number
    overheadCostRatio: number
    overheadTokenRatio: number
    avgCacheHitRate: number
  }
}

function formatMs(ms: number): string {
  if (ms < 1000) return `${ms.toFixed(0)}ms`
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`
  const m = Math.floor(ms / 60000)
  const s = Math.floor((ms % 60000) / 1000)
  return `${m}m ${s}s`
}

function formatCost(cost: number): string {
  if (cost < 0.001) return `${(cost * 100_000).toFixed(1)} µ¢`
  if (cost < 0.01) return `${(cost * 1000).toFixed(2)} ¢`
  return `$${cost.toFixed(4)}`
}

function formatTokens(n: number): string {
  if (n < 1000) return `${n}`
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}K`
  return `${(n / 1_000_000).toFixed(2)}M`
}

function bar(ratio: number, width = 20): string {
  const filled = Math.round(Math.min(ratio, 1) * width)
  return "[" + "█".repeat(Math.max(0, filled)) + "░".repeat(Math.max(0, width - filled)) + "]"
}

function displayReport(report: BenchmarkReport): void {
  const s = report.summary

  console.log("")
  console.log("╔══════════════════════════════════════════════════╗")
  console.log("║        Loop Agent Benchmark Report              ║")
  console.log("╚══════════════════════════════════════════════════╝")
  console.log("")
  console.log(`Runs analyzed: ${s.totalRuns}`)
  console.log(`Average duration: ${formatMs(s.avgDurationMs)}`)
  console.log(`Average cost: ${formatCost(s.avgCost)}`)
  console.log(`Average tokens/run: ${formatTokens(s.avgTokensPerRun)}`)
  console.log(`Average phases/run: ${s.avgPhasesPerRun.toFixed(1)}`)
  console.log(`Overhead cost ratio: ${(s.overheadCostRatio * 100).toFixed(1)}%`)
  console.log(`Overhead token ratio: ${(s.overheadTokenRatio * 100).toFixed(1)}%`)
  console.log(`Average cache hit rate: ${(s.avgCacheHitRate * 100).toFixed(1)}%`)

  console.log("")
  console.log("── Per-Run Breakdown ──")
  console.log("")
  console.log(
    "ID  │ Phases │ Duration │ Cost        │ Tokens       │ Overhead",
  )
  console.log("────┼────────┼──────────┼─────────────┼──────────────┼──────────")

  for (const [i, run] of report.runs.entries()) {
    const id = `${i + 1}`.padStart(2)
    const phases = `${run.phases.length}`.padStart(4)
    const dur = formatMs(run.totalDurationMs).padStart(8)
    const cost = formatCost(run.totalCost).padStart(11)
    const tokens = formatTokens(
      run.totalTokens.input + run.totalTokens.output + run.totalTokens.reasoning,
    ).padStart(9)
    const overheadRatio = run.totalCost > 0
      ? run.orchestratorCost / run.totalCost * 100
      : run.totalTokens.input + run.totalTokens.output > 0
        ? (run.orchestratorTokens.input + run.orchestratorTokens.output) / (run.totalTokens.input + run.totalTokens.output) * 100
        : 0
    const overhead = `${overheadRatio.toFixed(0)}%`.padStart(8)
    console.log(`${id}  │ ${phases} │ ${dur} │ ${cost} │ ${tokens}       │ ${overhead}`)
  }

  console.log("")
  console.log("── Phase Detail ──")
  console.log("")

  for (const [i, run] of report.runs.entries()) {
    console.log(`Run ${i + 1}: ${run.phases.length} phases, ${formatCost(run.totalCost)}, ${formatMs(run.totalDurationMs)}`)
    console.log(`  Orchestrator: ${formatCost(run.orchestratorCost)}, ${formatTokens(run.orchestratorTokens.input + run.orchestratorTokens.output)} tokens`)

    const maxDuration = run.phases.reduce((m, p) => Math.max(m, p.durationMs), 0) || 1

    for (const [j, phase] of run.phases.entries()) {
      const phaseLabel = `  Phase ${j + 1}:`.padEnd(30)
      const phaseCost = formatCost(phase.cost).padStart(10)
      const phaseTime = formatMs(phase.durationMs).padStart(8)
      const phaseTokens = formatTokens(
        phase.tokens.input + phase.tokens.output + phase.tokens.reasoning,
      ).padStart(8)
      const timeBar = bar(phase.durationMs / maxDuration)
      console.log(`${phaseLabel}${phaseCost} │ ${phaseTokens} tok │ ${phaseTime} ${timeBar}`)
    }
    console.log("")
  }
}

const aggregateMetrics = Effect.fn("LoopBench.aggregate")(function* (sessions: Array<Session.Info>) {
  let totalCost = 0
  const totalTokens = { input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0 }
  let minTime = Infinity
  let maxTime = 0
  let hasTime = false

  for (const s of sessions) {
    totalCost += s.cost || 0
    totalTokens.input += s.tokens?.input || 0
    totalTokens.output += s.tokens?.output || 0
    totalTokens.reasoning += s.tokens?.reasoning || 0
    totalTokens.cacheRead += s.tokens?.cache?.read || 0
    totalTokens.cacheWrite += s.tokens?.cache?.write || 0
    if (s.time.created) {
      const t = s.time.created
      if (t < minTime) minTime = t
      hasTime = true
    }
    if (s.time.updated) {
      const t = s.time.updated
      if (t > maxTime) maxTime = t
      hasTime = true
    }
  }

  return {
    totalCost,
    totalTokens,
    durationMs: hasTime && maxTime > minTime && isFinite(minTime) ? maxTime - minTime : 0,
  }
})

export const LoopBenchCommand = effectCmd({
  command: "loop-bench",
  describe: "analyze token usage and cost of Loop Agent runs",
  instance: false,
  builder: (yargs) =>
    yargs
      .option("days", {
        describe: "analyze runs from the last N days (default: 7)",
        type: "number",
      })
      .option("project", {
        describe: "filter by project (default: all projects, empty string: current project)",
        type: "string",
      })
      .option("session", {
        describe: "analyze a specific session ID",
        type: "string",
      }),
  handler: Effect.fn("Cli.loopBench")(function* (args) {
    const { db } = yield* Database.Service

    const days = args.days ?? 7
    const MS_IN_DAY = 24 * 60 * 60 * 1000
    const cutoffTime = days > 0 ? Date.now() - days * MS_IN_DAY : 0

    let rows: Array<typeof SessionTable.$inferSelect>

    if (args.session) {
      rows = yield* db
        .select()
        .from(SessionTable)
        .where(sql`${SessionTable.id} = ${args.session}`)
        .all()
        .pipe(Effect.orDie)
    } else {
      rows = yield* db
        .select()
        .from(SessionTable)
        .all()
        .pipe(Effect.orDie)
    }

    const sessions = rows
      .map((row) => Session.fromRow(row))
      .filter((s) => {
        if (cutoffTime > 0 && s.time.created && s.time.created < cutoffTime) return false
        return !(args.project && s.projectID !== args.project)
      })

    const loopSessions = sessions.filter((s) => s.agent === "loop")
    const childMap = new Map<string, Array<Session.Info>>()

    for (const s of sessions) {
      if (s.parentID) {
        const children = childMap.get(s.parentID) || []
        children.push(s)
        childMap.set(s.parentID, children)
      }
    }

    if (loopSessions.length === 0) {
      console.log("No Loop Agent runs found in the specified time range.")
      console.log("")
      console.log("Tip: Use the loop agent with:")
      console.log("  opencode run --agent loop <task>")
      console.log("")
      console.log("Then run this command to analyze the results.")
      return
    }

    const runs: LoopRunMetrics[] = []

    for (const loopSession of loopSessions) {
      const children = childMap.get(loopSession.id) || []
      const orchestratorMetrics = yield* aggregateMetrics([loopSession])

      const phases: PhaseMetrics[] = []
      let totalPhaseCost = 0
      const totalPhaseTokens = { input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0 }

      for (const child of children) {
        const m = yield* aggregateMetrics([child])
        totalPhaseCost += m.totalCost
        totalPhaseTokens.input += m.totalTokens.input
        totalPhaseTokens.output += m.totalTokens.output
        totalPhaseTokens.reasoning += m.totalTokens.reasoning
        totalPhaseTokens.cacheRead += m.totalTokens.cacheRead
        totalPhaseTokens.cacheWrite += m.totalTokens.cacheWrite

        phases.push({
          sessionID: child.id,
          agent: child.agent,
          durationMs: m.durationMs,
          cost: m.totalCost,
          tokens: { ...m.totalTokens },
        })
      }

      const totalCost = orchestratorMetrics.totalCost + totalPhaseCost
      const totalTokens = {
        input: orchestratorMetrics.totalTokens.input + totalPhaseTokens.input,
        output: orchestratorMetrics.totalTokens.output + totalPhaseTokens.output,
        reasoning: orchestratorMetrics.totalTokens.reasoning + totalPhaseTokens.reasoning,
        cacheRead: orchestratorMetrics.totalTokens.cacheRead + totalPhaseTokens.cacheRead,
        cacheWrite: orchestratorMetrics.totalTokens.cacheWrite + totalPhaseTokens.cacheWrite,
      }

      runs.push({
        orchestratorSessionID: loopSession.id,
        orchestratorCost: orchestratorMetrics.totalCost,
        orchestratorTokens: { ...orchestratorMetrics.totalTokens },
        orchestratorDurationMs: orchestratorMetrics.durationMs,
        phases,
        totalDurationMs: orchestratorMetrics.durationMs,
        totalCost,
        totalTokens,
        startedAt: loopSession.time.created ? new Date(loopSession.time.created) : null,
        endedAt: loopSession.time.updated ? new Date(loopSession.time.updated) : null,
      })
    }

    if (runs.length === 0) {
      console.log("No Loop Agent runs found in the specified time range.")
      return
    }

    const totalDurationMs = runs.reduce((sum, r) => sum + r.totalDurationMs, 0)
    const totalCost = runs.reduce((sum, r) => sum + r.totalCost, 0)
    const totalRawTokens = runs.reduce(
      (sum, r) => sum + r.totalTokens.input + r.totalTokens.output + r.totalTokens.reasoning,
      0,
    )
    const totalPhases = runs.reduce((sum, r) => sum + r.phases.length, 0)
    const totalOrchestratorCost = runs.reduce((sum, r) => sum + r.orchestratorCost, 0)
    const totalOrchestratorTokens = runs.reduce(
      (sum, r) => sum + r.orchestratorTokens.input + r.orchestratorTokens.output,
      0,
    )
    const totalCacheRead = runs.reduce((sum, r) => sum + r.totalTokens.cacheRead, 0)
    const totalCacheTotal = runs.reduce(
      (sum, r) => sum + r.totalTokens.cacheRead + r.totalTokens.cacheWrite,
      0,
    )

    const report: BenchmarkReport = {
      runs,
      summary: {
        totalRuns: runs.length,
        avgDurationMs: totalDurationMs / runs.length,
        avgCost: totalCost / runs.length,
        avgTokensPerRun: totalRawTokens / runs.length,
        avgPhasesPerRun: totalPhases / runs.length,
        overheadCostRatio: totalCost > 0 ? totalOrchestratorCost / totalCost : 0,
        overheadTokenRatio: totalRawTokens > 0 ? totalOrchestratorTokens / totalRawTokens : 0,
        avgCacheHitRate: totalCacheTotal > 0 ? totalCacheRead / totalCacheTotal : 0,
      },
    }

    displayReport(report)
  }),
})
