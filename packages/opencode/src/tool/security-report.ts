import z from "zod"
import { Tool } from "./tool"
import { Instance } from "../project/instance"
import DESCRIPTION from "./security-report.txt"
import path from "path"
import * as fs from "fs"
import { Log } from "../util/log"

const log = Log.create({ service: "security-report" })

function generateExecutiveSummary(findings: any): string {
  const lines: string[] = []
  const total = findings.total || 0
  const critical = findings.critical || 0
  const high = findings.high || 0
  const medium = findings.medium || 0
  const low = findings.low || 0

  // Calculate grade
  let grade: string
  let score: number
  if (critical > 0) {
    grade = critical > 5 ? "F" : "D"
    score = Math.max(0, 30 - critical * 5 - high * 3)
  } else if (high > 0) {
    grade = high > 5 ? "D" : "C"
    score = Math.max(20, 60 - high * 5 - medium * 2)
  } else if (medium > 0) {
    grade = medium > 10 ? "C" : "B"
    score = Math.max(50, 80 - medium * 3 - low)
  } else if (low > 0) {
    grade = "B+"
    score = Math.max(75, 95 - low * 2)
  } else {
    grade = "A"
    score = 100
  }

  lines.push("## Executive Summary")
  lines.push("")
  lines.push(`### Overall Security Grade: ${grade} (${score}/100)`)
  lines.push("")
  lines.push("### Risk Overview")
  lines.push("")
  lines.push("| Severity | Count | Status |")
  lines.push("|----------|-------|--------|")
  lines.push(`| Critical | ${critical} | ${critical > 0 ? "IMMEDIATE ACTION REQUIRED" : "Clear"} |`)
  lines.push(`| High | ${high} | ${high > 0 ? "Urgent remediation needed" : "Clear"} |`)
  lines.push(`| Medium | ${medium} | ${medium > 0 ? "Planned remediation" : "Clear"} |`)
  lines.push(`| Low | ${low} | ${low > 0 ? "Monitor and review" : "Clear"} |`)
  lines.push(`| **Total** | **${total}** | |`)
  lines.push("")

  lines.push("### Key Recommendations")
  lines.push("")
  if (critical > 0) {
    lines.push(`1. **CRITICAL**: ${critical} critical vulnerabilities require immediate patching`)
  }
  if (high > 0) {
    lines.push(`${critical > 0 ? "2" : "1"}. **HIGH PRIORITY**: ${high} high-severity issues need urgent attention`)
  }
  if (findings.secrets > 0) {
    lines.push(`- **SECRETS**: ${findings.secrets} exposed credentials must be rotated immediately`)
  }
  if (findings.dependencies > 0) {
    lines.push(`- **DEPENDENCIES**: ${findings.dependencies} vulnerable dependencies need upgrading`)
  }

  return lines.join("\n")
}

function generateTechnicalReport(findings: any): string {
  const lines: string[] = []

  lines.push("## Technical Security Assessment Report")
  lines.push("")
  lines.push("### Methodology")
  lines.push("")
  lines.push("This assessment was performed using OpenCode's integrated security analysis tools:")
  lines.push("")
  lines.push("1. **Static Application Security Testing (SAST)** - Pattern-based code analysis")
  lines.push("2. **Secret Detection** - Credential and sensitive data scanning")
  lines.push("3. **Software Composition Analysis (SCA)** - Dependency vulnerability auditing")
  lines.push("4. **CVE Intelligence** - Cross-referencing with NVD, OSV, and GitHub Advisories")
  lines.push("")
  lines.push("### Scope")
  lines.push("")
  lines.push(`- **Target**: ${findings.target || "Project directory"}`)
  lines.push(`- **Date**: ${new Date().toISOString()}`)
  lines.push(`- **Files Scanned**: ${findings.filesScanned || "N/A"}`)
  lines.push(`- **Dependencies Analyzed**: ${findings.depsAnalyzed || "N/A"}`)
  lines.push("")

  lines.push("### OWASP Top 10 Compliance Matrix")
  lines.push("")
  lines.push("| OWASP Category | Status | Findings |")
  lines.push("|---------------|--------|----------|")
  lines.push(`| A01: Broken Access Control | ${findings.owasp?.A01 ? "FAIL" : "PASS"} | ${findings.owasp?.A01 || 0} |`)
  lines.push(`| A02: Cryptographic Failures | ${findings.owasp?.A02 ? "FAIL" : "PASS"} | ${findings.owasp?.A02 || 0} |`)
  lines.push(`| A03: Injection | ${findings.owasp?.A03 ? "FAIL" : "PASS"} | ${findings.owasp?.A03 || 0} |`)
  lines.push(`| A04: Insecure Design | ${findings.owasp?.A04 ? "FAIL" : "PASS"} | ${findings.owasp?.A04 || 0} |`)
  lines.push(`| A05: Security Misconfiguration | ${findings.owasp?.A05 ? "FAIL" : "PASS"} | ${findings.owasp?.A05 || 0} |`)
  lines.push(`| A06: Vulnerable Components | ${findings.owasp?.A06 ? "FAIL" : "PASS"} | ${findings.owasp?.A06 || 0} |`)
  lines.push(`| A07: Auth Failures | ${findings.owasp?.A07 ? "FAIL" : "PASS"} | ${findings.owasp?.A07 || 0} |`)
  lines.push(`| A08: Data Integrity Failures | ${findings.owasp?.A08 ? "FAIL" : "PASS"} | ${findings.owasp?.A08 || 0} |`)
  lines.push(`| A09: Logging Failures | ${findings.owasp?.A09 ? "FAIL" : "PASS"} | ${findings.owasp?.A09 || 0} |`)
  lines.push(`| A10: SSRF | ${findings.owasp?.A10 ? "FAIL" : "PASS"} | ${findings.owasp?.A10 || 0} |`)
  lines.push("")

  lines.push("### CWE Distribution")
  lines.push("")
  if (findings.cwes && Object.keys(findings.cwes).length > 0) {
    lines.push("| CWE ID | Title | Count |")
    lines.push("|--------|-------|-------|")
    for (const [cwe, count] of Object.entries(findings.cwes)) {
      lines.push(`| ${cwe} | - | ${count} |`)
    }
  } else {
    lines.push("No CWE-classified findings detected.")
  }

  return lines.join("\n")
}

function generateComplianceReport(findings: any, standard: string): string {
  const lines: string[] = []

  lines.push(`## Compliance Assessment: ${standard.toUpperCase()}`)
  lines.push("")
  lines.push(`### Assessment Date: ${new Date().toISOString()}`)
  lines.push("")

  switch (standard.toLowerCase()) {
    case "owasp":
      lines.push("### OWASP Application Security Verification Standard (ASVS)")
      lines.push("")
      lines.push("| Control | Requirement | Status | Notes |")
      lines.push("|---------|------------|--------|-------|")
      lines.push(`| V1.1 | Secure SDLC | REVIEW | Manual verification required |`)
      lines.push(`| V2.1 | Password Security | ${findings.auth_issues ? "FAIL" : "PASS"} | ${findings.auth_issues || 0} issues found |`)
      lines.push(`| V3.1 | Session Management | REVIEW | Manual verification required |`)
      lines.push(`| V4.1 | Access Control | ${findings.access_issues ? "FAIL" : "PASS"} | ${findings.access_issues || 0} issues found |`)
      lines.push(`| V5.1 | Input Validation | ${findings.injection_issues ? "FAIL" : "PASS"} | ${findings.injection_issues || 0} issues found |`)
      lines.push(`| V6.1 | Cryptography | ${findings.crypto_issues ? "FAIL" : "PASS"} | ${findings.crypto_issues || 0} issues found |`)
      lines.push(`| V7.1 | Error Handling | ${findings.misc_issues ? "FAIL" : "PASS"} | ${findings.misc_issues || 0} issues found |`)
      lines.push(`| V8.1 | Data Protection | ${findings.secrets ? "FAIL" : "PASS"} | ${findings.secrets || 0} secrets exposed |`)
      lines.push(`| V9.1 | Communication | ${findings.tls_issues ? "FAIL" : "PASS"} | ${findings.tls_issues || 0} TLS issues |`)
      lines.push(`| V10.1 | Malicious Code | REVIEW | Manual verification required |`)
      lines.push(`| V14.1 | Configuration | ${findings.config_issues ? "FAIL" : "PASS"} | ${findings.config_issues || 0} misconfigurations |`)
      break

    case "pci-dss":
      lines.push("### PCI DSS v4.0 Relevant Controls")
      lines.push("")
      lines.push("| Requirement | Description | Status |")
      lines.push("|------------|------------|--------|")
      lines.push(`| 6.2.4 | Software engineering techniques prevent attacks | ${findings.total > 0 ? "NON-COMPLIANT" : "COMPLIANT"} |`)
      lines.push(`| 6.3.1 | Security vulnerabilities identified and managed | REVIEW |`)
      lines.push(`| 6.3.2 | Inventory of bespoke and custom software | REVIEW |`)
      lines.push(`| 6.5.1 | Injection attack prevention | ${findings.injection_issues ? "NON-COMPLIANT" : "COMPLIANT"} |`)
      lines.push(`| 6.5.4 | Cryptography implementation | ${findings.crypto_issues ? "NON-COMPLIANT" : "COMPLIANT"} |`)
      lines.push(`| 8.3.6 | Password complexity requirements | ${findings.auth_issues ? "REVIEW" : "COMPLIANT"} |`)
      break

    default:
      lines.push(`### ${standard} Compliance`)
      lines.push("")
      lines.push("Automated compliance checking for this standard requires manual review.")
      lines.push("The security findings from this scan should be mapped to the applicable controls.")
  }

  return lines.join("\n")
}

function generateSARIF(findings: any): string {
  const sarif = {
    $schema: "https://raw.githubusercontent.com/oasis-tcs/sarif-spec/main/sarif-2.1/schema/sarif-schema-2.1.0.json",
    version: "2.1.0",
    runs: [
      {
        tool: {
          driver: {
            name: "OpenCode Security Scanner",
            version: "1.0.0",
            informationUri: "https://github.com/anomalyco/opencode",
            rules: (findings.details || []).map((f: any) => ({
              id: f.id,
              name: f.title,
              shortDescription: { text: f.title },
              fullDescription: { text: f.description },
              defaultConfiguration: {
                level: f.severity === "critical" || f.severity === "high" ? "error" : f.severity === "medium" ? "warning" : "note",
              },
              properties: {
                tags: [f.owasp, f.cwe].filter(Boolean),
              },
            })),
          },
        },
        results: (findings.details || []).map((f: any) => ({
          ruleId: f.id,
          level: f.severity === "critical" || f.severity === "high" ? "error" : f.severity === "medium" ? "warning" : "note",
          message: { text: f.description },
          locations: [
            {
              physicalLocation: {
                artifactLocation: { uri: f.file },
                region: { startLine: f.line || 1 },
              },
            },
          ],
        })),
      },
    ],
  }

  return JSON.stringify(sarif, null, 2)
}

export const SecurityReportTool = Tool.define("security_report", async () => {
  return {
    description: DESCRIPTION,
    parameters: z.object({
      reportType: z
        .enum(["executive", "technical", "compliance", "pentest", "audit", "diff", "sbom"])
        .default("technical")
        .describe("Type of security report to generate"),
      format: z
        .enum(["markdown", "html", "json", "sarif", "csv"])
        .default("markdown")
        .describe("Output format for the report"),
      outputPath: z
        .string()
        .optional()
        .describe("File path to save the report. If not specified, output is returned directly."),
      standard: z
        .string()
        .optional()
        .describe("Compliance standard for compliance reports (owasp, pci-dss, soc2, hipaa, iso27001)"),
      findings: z
        .string()
        .optional()
        .describe("JSON string with findings data from previous scans. If not provided, generates a template report."),
      projectName: z
        .string()
        .optional()
        .describe("Project name for the report header"),
    }),
    async execute(params, ctx) {
      await ctx.ask({
        permission: "security_report",
        patterns: [params.outputPath || "stdout"],
        always: ["*"],
        metadata: { reportType: params.reportType, format: params.format },
      })

      log.info("generating security report", { reportType: params.reportType, format: params.format })

      // Parse findings data
      let findings: any = {}
      if (params.findings) {
        try {
          findings = JSON.parse(params.findings)
        } catch {
          findings = {}
        }
      }

      findings.target = findings.target || Instance.directory
      findings.projectName = params.projectName || path.basename(Instance.directory)

      // Generate report content
      const sections: string[] = []

      // Report header
      sections.push("# Security Assessment Report")
      sections.push("")
      sections.push(`**Project**: ${findings.projectName}`)
      sections.push(`**Date**: ${new Date().toISOString()}`)
      sections.push(`**Report Type**: ${params.reportType.charAt(0).toUpperCase() + params.reportType.slice(1)}`)
      sections.push(`**Generated by**: OpenCode Security Suite`)
      sections.push("")
      sections.push("---")
      sections.push("")

      switch (params.reportType) {
        case "executive":
          sections.push(generateExecutiveSummary(findings))
          break

        case "technical":
          sections.push(generateExecutiveSummary(findings))
          sections.push("")
          sections.push("---")
          sections.push("")
          sections.push(generateTechnicalReport(findings))
          break

        case "compliance":
          sections.push(generateComplianceReport(findings, params.standard || "owasp"))
          break

        case "pentest":
          sections.push("## Penetration Test Report")
          sections.push("")
          sections.push("### Methodology")
          sections.push("")
          sections.push("1. **Reconnaissance** - Automated codebase analysis and dependency mapping")
          sections.push("2. **Vulnerability Identification** - SAST scanning with OWASP-aligned rules")
          sections.push("3. **Secret Discovery** - Credential and sensitive data detection")
          sections.push("4. **Dependency Analysis** - Third-party component vulnerability assessment")
          sections.push("5. **Risk Assessment** - CVSS-based severity scoring and prioritization")
          sections.push("")
          sections.push(generateExecutiveSummary(findings))
          sections.push("")
          sections.push(generateTechnicalReport(findings))
          break

        case "audit":
          sections.push("## Security Audit Report")
          sections.push("")
          sections.push("### Audit Scope")
          sections.push("")
          sections.push("This audit evaluates the security posture of the codebase through automated analysis.")
          sections.push("")
          sections.push("### Controls Assessment")
          sections.push("")
          sections.push("| Control Area | Status | Details |")
          sections.push("|-------------|--------|---------|")
          sections.push(`| Input Validation | ${findings.injection_issues ? "GAPS FOUND" : "ADEQUATE"} | ${findings.injection_issues || 0} issues |`)
          sections.push(`| Authentication | ${findings.auth_issues ? "GAPS FOUND" : "ADEQUATE"} | ${findings.auth_issues || 0} issues |`)
          sections.push(`| Cryptography | ${findings.crypto_issues ? "GAPS FOUND" : "ADEQUATE"} | ${findings.crypto_issues || 0} issues |`)
          sections.push(`| Secret Management | ${findings.secrets ? "GAPS FOUND" : "ADEQUATE"} | ${findings.secrets || 0} exposed |`)
          sections.push(`| Dependency Management | ${findings.dependencies ? "GAPS FOUND" : "ADEQUATE"} | ${findings.dependencies || 0} vulnerable |`)
          sections.push(`| Configuration | ${findings.config_issues ? "GAPS FOUND" : "ADEQUATE"} | ${findings.config_issues || 0} misconfigs |`)
          sections.push("")
          sections.push(generateExecutiveSummary(findings))
          break

        case "diff":
          sections.push("## Differential Security Report")
          sections.push("")
          sections.push("Compares current scan results against a previous baseline.")
          sections.push("")
          sections.push("| Metric | Previous | Current | Delta |")
          sections.push("|--------|----------|---------|-------|")
          sections.push(`| Total Findings | ${findings.previousTotal || "N/A"} | ${findings.total || 0} | ${findings.total && findings.previousTotal ? findings.total - findings.previousTotal : "N/A"} |`)
          sections.push(`| Critical | ${findings.previousCritical || "N/A"} | ${findings.critical || 0} | ${findings.critical && findings.previousCritical ? findings.critical - findings.previousCritical : "N/A"} |`)
          sections.push(`| High | ${findings.previousHigh || "N/A"} | ${findings.high || 0} | ${findings.high && findings.previousHigh ? findings.high - findings.previousHigh : "N/A"} |`)
          break

        case "sbom":
          sections.push("## Software Bill of Materials (SBOM)")
          sections.push("")
          sections.push("### Component Inventory with Security Annotations")
          sections.push("")
          sections.push("| Component | Version | Ecosystem | Vulnerabilities | License |")
          sections.push("|-----------|---------|-----------|----------------|---------|")
          if (findings.components) {
            for (const comp of findings.components) {
              sections.push(`| ${comp.name} | ${comp.version} | ${comp.ecosystem} | ${comp.vulns || 0} | ${comp.license || "Unknown"} |`)
            }
          } else {
            sections.push("| Run dependency_audit first to populate SBOM data | | | | |")
          }
          break
      }

      // Footer
      sections.push("")
      sections.push("---")
      sections.push("")
      sections.push("*This report was generated by OpenCode Security Suite. For the most accurate results,")
      sections.push("complement automated scanning with manual security review and dynamic testing.*")

      let output = sections.join("\n")

      // Format conversion
      if (params.format === "sarif") {
        output = generateSARIF(findings)
      } else if (params.format === "json") {
        output = JSON.stringify(
          {
            report: {
              type: params.reportType,
              project: findings.projectName,
              date: new Date().toISOString(),
              findings,
            },
          },
          null,
          2,
        )
      } else if (params.format === "csv") {
        const csvLines = ["Severity,ID,Title,File,Line,CWE,OWASP,Description"]
        for (const f of findings.details || []) {
          csvLines.push(
            `${f.severity},${f.id},"${f.title}",${f.file || ""},${f.line || ""},${f.cwe || ""},${f.owasp || ""},"${(f.description || "").replace(/"/g, '""')}"`,
          )
        }
        output = csvLines.join("\n")
      } else if (params.format === "html") {
        output = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Security Report - ${findings.projectName}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 1200px; margin: 0 auto; padding: 20px; background: #0d1117; color: #c9d1d9; }
    h1, h2, h3 { color: #58a6ff; }
    table { border-collapse: collapse; width: 100%; margin: 16px 0; }
    th, td { border: 1px solid #30363d; padding: 8px 12px; text-align: left; }
    th { background: #161b22; color: #58a6ff; }
    tr:nth-child(even) { background: #161b22; }
    .critical { color: #f85149; font-weight: bold; }
    .high { color: #db6d28; font-weight: bold; }
    .medium { color: #d29922; }
    .low { color: #8b949e; }
    .pass { color: #3fb950; }
    .fail { color: #f85149; }
    code { background: #161b22; padding: 2px 6px; border-radius: 3px; }
    hr { border: 1px solid #30363d; }
    .grade { font-size: 48px; font-weight: bold; text-align: center; padding: 20px; }
  </style>
</head>
<body>
<pre>${output.replace(/</g, "&lt;").replace(/>/g, "&gt;")}</pre>
</body>
</html>`
      }

      // Save to file if outputPath specified
      if (params.outputPath) {
        const outputFilePath = path.isAbsolute(params.outputPath)
          ? params.outputPath
          : path.resolve(Instance.directory, params.outputPath)
        fs.writeFileSync(outputFilePath, output, "utf8")
        return {
          title: `Security Report saved: ${params.outputPath}`,
          metadata: {
            reportType: params.reportType,
            format: params.format,
            outputPath: outputFilePath,
          },
          output: `Security report saved to: ${outputFilePath}\n\n${output.substring(0, 2000)}${output.length > 2000 ? "\n\n[Report truncated in output - full report saved to file]" : ""}`,
        }
      }

      return {
        title: `Security Report (${params.reportType})`,
        metadata: {
          reportType: params.reportType,
          format: params.format,
        },
        output,
      }
    },
  }
})
