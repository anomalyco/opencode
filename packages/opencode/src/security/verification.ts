import { parseReport } from "./report-parser"
import type { RetrievedControl, SecurityMode, SecurityVerification } from "./schema"

function generic(report: string) {
  const txt = report.toLowerCase()
  if (report.trim().length < 350) return true
  const weak = [
    "best practices should be followed",
    "ensure security measures are in place",
    "further review is recommended",
  ]
  return weak.some((x) => txt.includes(x))
}

export function verifyReport(input: {
  report: string
  mode: SecurityMode
  controls: RetrievedControl[]
}): SecurityVerification {
  const parsed = parseReport(input.report)
  const checks: SecurityVerification["checks"] = []
  const warnings: string[] = []

  const structural =
    parsed.hasExecutiveSummary === true && parsed.hasFindings === true && parsed.hasFinalRiskOverview === true
  checks.push({
    name: "structural-completeness",
    passed: structural,
    detail: structural ? "All required sections exist." : "Missing one or more required sections.",
  })

  const evidenceMissing = parsed.findings.filter((item) => !item.evidence || item.evidence.trim().length === 0)
  checks.push({
    name: "evidence-grounding",
    passed: evidenceMissing.length === 0,
    detail:
      evidenceMissing.length === 0
        ? "All findings include evidence."
        : `${evidenceMissing.length} finding(s) missing evidence field.`,
  })

  if (input.mode === "rag") {
    const allowed = new Set(input.controls.map((x) => x.id))
    const unsupported = parsed.findings
      .map((x) => x.control)
      .filter((x): x is string => Boolean(x))
      .flatMap((x) => {
        const ids = x.match(/[A-Za-z]+[-_]\d+/g) ?? []
        return ids.filter((id) => !allowed.has(id))
      })
    checks.push({
      name: "control-grounding",
      passed: unsupported.length === 0,
      detail:
        unsupported.length === 0
          ? "Control references align with retrieved controls."
          : `Unsupported control refs: ${Array.from(new Set(unsupported)).join(", ")}`,
    })
  }

  const inconsistent = parsed.findings.filter((x) => {
    const sev = (x.severity ?? "").toLowerCase()
    const issue = (x.issue ?? "").toLowerCase()
    const rec = (x.recommendation ?? "").trim().length > 0
    const evidence = (x.evidence ?? "").trim().length > 0
    if (issue.includes("no issue") && (sev === "high" || sev === "critical")) return true
    if (rec && (!x.issue || !evidence)) return true
    return false
  })
  checks.push({
    name: "consistency",
    passed: inconsistent.length === 0,
    detail:
      inconsistent.length === 0
        ? "No obvious issue/severity/recommendation inconsistencies."
        : `${inconsistent.length} inconsistent finding(s) detected.`,
  })

  const empty = generic(input.report)
  checks.push({
    name: "empty-generic-detection",
    passed: !empty,
    detail: empty ? "Report is too short or generic." : "Report has sufficient specific content.",
  })

  if (parsed.findings.length === 0) warnings.push("No findings were parsed from the report.")
  if (evidenceMissing.length > 0) warnings.push("Some findings are missing evidence.")

  const passCount = checks.filter((x) => x.passed).length
  const score = checks.length === 0 ? 0 : passCount / checks.length
  return {
    passed: checks.every((x) => x.passed),
    checks,
    warnings,
    score,
  }
}

export function verificationSummary(verification: SecurityVerification) {
  const lines = [
    `passed: ${verification.passed}`,
    `score: ${verification.score.toFixed(2)}`,
    "",
    "checks:",
    ...verification.checks.map((x) => `- ${x.name}: ${x.passed ? "pass" : "fail"} (${x.detail})`),
  ]
  if (verification.warnings.length > 0) {
    lines.push("", "warnings:")
    lines.push(...verification.warnings.map((x) => `- ${x}`))
  }
  return lines.join("\n")
}
