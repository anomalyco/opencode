export type ParsedFinding = {
  id?: string
  issue?: string
  severity?: string
  evidence?: string
  control?: string
  recommendation?: string
}

export type ParsedReport = {
  hasExecutiveSummary: boolean
  hasFindings: boolean
  hasFinalRiskOverview: boolean
  findings: ParsedFinding[]
}

function field(block: string, label: string) {
  const line = block
    .split("\n")
    .find((x) => x.toLowerCase().includes(label.toLowerCase() + ":"))
  if (!line) return undefined
  return line.split(":").slice(1).join(":").trim()
}

export function parseReport(report: string): ParsedReport {
  const hasExecutiveSummary = /(^|\n)#{1,3}\s*Executive Summary\b/i.test(report)
  const hasFindings = /(^|\n)#{1,3}\s*Findings\b/i.test(report)
  const hasFinalRiskOverview = /(^|\n)#{1,3}\s*Final Risk Overview\b/i.test(report)

  const chunks = report
    .split(/\n(?=###\s*Finding\b)/i)
    .map((x) => x.trim())
    .filter((x) => /^###\s*Finding\b/i.test(x))

  const findings = chunks.map((block) => ({
    id: field(block, "Finding ID"),
    issue: field(block, "Observed Issue"),
    severity: field(block, "Severity"),
    evidence: field(block, "Evidence"),
    control: field(block, "Related Control / Principle"),
    recommendation: field(block, "Recommendation"),
  }))

  return { hasExecutiveSummary, hasFindings, hasFinalRiskOverview, findings }
}
