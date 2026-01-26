/**
 * SWE-bench Report Generator
 */

import type { InstanceResult, RunReport } from "./types"

interface ReportInput {
  runId: string
  model: string
  dataset: string
  agent?: string
  startTime: number
  endTime: number
  results: InstanceResult[]
}

/** Generate run report */
export function generateReport(input: ReportInput): RunReport {
  const total = input.results.length
  const success = input.results.filter((r) => r.status === "success").length
  const failed = input.results.filter((r) => r.status === "error").length
  const timeout = input.results.filter((r) => r.status === "timeout").length

  const durations = input.results.map((r) => r.duration)
  const avgDuration = durations.length > 0 ? durations.reduce((a, b) => a + b, 0) / durations.length : 0

  return {
    runId: input.runId,
    model: input.model,
    dataset: input.dataset,
    agent: input.agent,
    startTime: input.startTime,
    endTime: input.endTime,
    stats: {
      total,
      completed: success + failed + timeout,
      success,
      failed,
      timeout,
      avgDuration: Math.round(avgDuration),
    },
    results: input.results,
  }
}

/** Format report as human-readable text */
export function formatReportText(report: RunReport): string {
  const lines: string[] = []

  lines.push("=" .repeat(60))
  lines.push("SWE-bench Evaluation Report")
  lines.push("=" .repeat(60))
  lines.push("")
  lines.push(`Run ID:     ${report.runId}`)
  lines.push(`Model:      ${report.model}`)
  lines.push(`Dataset:    ${report.dataset}`)
  if (report.agent) {
    lines.push(`Agent:      ${report.agent}`)
  }
  lines.push(`Start Time: ${new Date(report.startTime).toISOString()}`)
  lines.push(`End Time:   ${new Date(report.endTime).toISOString()}`)
  lines.push(`Duration:   ${formatDuration(report.endTime - report.startTime)}`)
  lines.push("")
  lines.push("-".repeat(60))
  lines.push("Statistics")
  lines.push("-".repeat(60))
  lines.push(`Total Instances:    ${report.stats.total}`)
  lines.push(`Completed:          ${report.stats.completed}`)
  lines.push(`Success:            ${report.stats.success} (${percentage(report.stats.success, report.stats.total)})`)
  lines.push(`Failed:             ${report.stats.failed} (${percentage(report.stats.failed, report.stats.total)})`)
  lines.push(`Timeout:            ${report.stats.timeout} (${percentage(report.stats.timeout, report.stats.total)})`)
  lines.push(`Avg Duration:       ${formatDuration(report.stats.avgDuration)}`)
  lines.push("")

  // Failed instance details
  const failures = report.results.filter((r) => r.status !== "success")
  if (failures.length > 0) {
    lines.push("-".repeat(60))
    lines.push("Failed Instances")
    lines.push("-".repeat(60))
    for (const f of failures.slice(0, 20)) {
      lines.push(`  ${f.instance_id}: ${f.status}${f.error ? ` - ${f.error.slice(0, 50)}` : ""}`)
    }
    if (failures.length > 20) {
      lines.push(`  ... and ${failures.length - 20} more`)
    }
  }

  lines.push("")
  lines.push("=" .repeat(60))

  return lines.join("\n")
}

function percentage(part: number, total: number): string {
  if (total === 0) return "0.0%"
  return ((part / total) * 100).toFixed(1) + "%"
}

function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000)
  const minutes = Math.floor(seconds / 60)
  const hours = Math.floor(minutes / 60)

  if (hours > 0) return `${hours}h ${minutes % 60}m ${seconds % 60}s`
  if (minutes > 0) return `${minutes}m ${seconds % 60}s`
  return `${seconds}s`
}

/** Merge multiple reports (for aggregating multiple runs) */
export function mergeReports(reports: RunReport[]): RunReport {
  if (reports.length === 0) {
    throw new Error("No reports to merge")
  }

  const allResults = reports.flatMap((r) => r.results)
  const startTime = Math.min(...reports.map((r) => r.startTime))
  const endTime = Math.max(...reports.map((r) => r.endTime))

  return generateReport({
    runId: `merged-${reports.map((r) => r.runId).join("+")}`,
    model: reports[0].model,
    dataset: reports[0].dataset,
    agent: reports[0].agent,
    startTime,
    endTime,
    results: allResults,
  })
}
