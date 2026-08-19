import { generateDoctorReport, generateRepairPlan, type RepairPlan } from "@opencode-ai/core/database/health"
import { applyRepairPlan, type ApplyResult } from "@opencode-ai/core/database/repair"

type CommandExitCode = 0 | 1 | 2

export async function runDoctorCommand(dbPath: string, args: { json: boolean }): Promise<{ exitCode: CommandExitCode; issueCount: number }> {
  const report = await generateDoctorReport(dbPath)
  if (args.json) console.log(JSON.stringify(report, null, 2))
  else printDoctorReport(report)
  return { exitCode: report.exitCode, issueCount: report.issues.length }
}

export async function runRepairCommand(
  dbPath: string,
  args: { dryRun?: boolean; "dry-run"?: boolean; apply: boolean; json: boolean },
): Promise<{ exitCode: CommandExitCode; message: string }> {
  const plan = await generateRepairPlan(dbPath)
  if (args.dryRun || args["dry-run"]) {
    if (args.json) console.log(JSON.stringify(plan, null, 2))
    else printRepairPlan(plan)
    return { exitCode: plan.exitCode, message: `Repair dry-run found ${plan.operations.length} operation(s)` }
  }

  const applyResult = await applyRepairPlan(plan)
  if (args.json) console.log(JSON.stringify({ ...applyResult, exitCode: applyResult.success ? 0 : 2 }, null, 2))
  else printApplyResult(plan, applyResult)
  return { exitCode: (applyResult.success ? 0 : 2) satisfies CommandExitCode, message: applyResult.error || "Repair failed" }
}

function printDoctorReport(report: Awaited<ReturnType<typeof generateDoctorReport>>) {
  console.log("OpenCode DB Doctor")
  console.log("==================")
  console.log(`Database: ${report.dbPath}`)
  console.log(`Schema: ${report.schemaSupported ? "supported" : "unsupported"}`)
  console.log(`Target OpenCode: ${report.compatibility.targetOpenCodeVersion}`)
  console.log(`Target migration: ${report.compatibility.latestExpectedMigration ?? "none"}`)
  console.log(`Applied migration: ${report.compatibility.latestAppliedMigration ?? "none"}`)
  console.log(`Sessions: ${report.sessionCount ?? 0}`)
  console.log(`Messages: ${report.messageCount ?? 0}`)
  console.log("")
  console.log("Supported repairs:")
  report.supportedRepairs.forEach((repair) => console.log(`- ${repair.code}: target ${repair.targetMigration ?? report.compatibility.targetOpenCodeVersion}; ${repair.targetInvariant}`))
  console.log("")
  if (report.issues.length === 0) console.log("Issues: None")
  report.issues.forEach((issue) => {
    console.log(`- [${issue.severity}] ${issue.code}: ${issue.reason}`)
    if (issue.sessionId) console.log(`  session: ${issue.sessionId}`)
    if (issue.messageId) console.log(`  message: ${issue.messageId}`)
    console.log(`  repairable: ${issue.repairable ? issue.suggestedRepair ?? "yes" : "no"}`)
  })
  console.log("")
  console.log("No changes were made.")
  console.log(`Exit code: ${report.exitCode}`)
}

function printRepairPlan(plan: RepairPlan) {
  console.log("OpenCode DB Repair (Dry Run)")
  console.log("============================")
  console.log(`Database: ${plan.dbPath}`)
  console.log(`Mode: ${plan.mode}`)
  console.log(`Target OpenCode: ${plan.compatibility.targetOpenCodeVersion}`)
  console.log(`Target migration: ${plan.compatibility.latestExpectedMigration ?? "none"}`)
  console.log(`Applied migration: ${plan.compatibility.latestAppliedMigration ?? "none"}`)
  console.log("")
  console.log("Supported repairs:")
  plan.supportedRepairs.forEach((repair) => console.log(`- ${repair.code}: target ${repair.targetMigration ?? plan.compatibility.targetOpenCodeVersion}; ${repair.targetInvariant}`))
  console.log("")
  if (plan.operations.length === 0) console.log("Repair plan: No repairs needed")
  plan.operations.forEach((operation) => {
    console.log(`- ${operation.id}`)
    console.log(`  issue: ${operation.issueCode}`)
    console.log(`  table: ${operation.table}`)
    console.log(`  row: ${operation.rowId}`)
    console.log(`  before: ${JSON.stringify(operation.before)}`)
    console.log(`  after: ${JSON.stringify(operation.after)}`)
    console.log(`  reason: ${operation.reason}`)
    console.log(`  confidence: ${operation.confidence}`)
    console.log(`  backup required: ${operation.backupRequired}`)
    console.log(`  preconditions: ${JSON.stringify(operation.preconditions)}`)
    if (operation.warning) console.log(`  WARNING: ${operation.warning}`)
  })
  console.log("")
  console.log("No changes were made.")
  console.log(`Exit code: ${plan.exitCode}`)
}

function printApplyResult(plan: RepairPlan, result: ApplyResult) {
  console.log("OpenCode DB Repair (Apply)")
  console.log("==========================")
  console.log(`Database: ${plan.dbPath}`)
  if (result.backup.path) console.log(`Backup created: ${result.backup.path}`)
  if (!result.success) {
    console.log(`Repair failed: ${result.error}`)
    console.log(result.operationsApplied === 0 ? "No changes were applied. Database transaction was rolled back." : "Repairs were committed, but the post-check found remaining database errors. Review the backup before continuing.")
    console.log("Exit code: 2")
    return
  }
  plan.warnings.forEach((warning) => console.log(`WARNING: ${warning}`))
  console.log(`Operations applied: ${result.operationsApplied}`)
  console.log(`Post-check critical issues: ${result.postCheckIssues}`)
  console.log("Exit code: 0")
}
