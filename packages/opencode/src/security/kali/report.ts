// packages/opencode/src/security/kali/report.ts
import { $ } from "bun"
import { Flag } from "@/flag/flag"

export interface AuditFinding {
  severity: "critical" | "high" | "medium" | "low" | "info"
  title: string
  description: string
  evidence?: string
  cve?: string
  cvss?: number
}

export interface AuditReport {
  target: string
  targetType: "web" | "network" | "ad" | "code" | "ot"
  duration: number
  startTime: Date
  endTime: Date
  tools: string[]
  findings: AuditFinding[]
  recommendations?: string[]
  metadata?: Record<string, unknown>
}

export namespace ReportGenerator {
  export function ensureReportDir(): void {
    const reportPath = Flag.OPENSACIA_REPORT_PATH
    try {
      $`mkdir -p ${reportPath}`.quiet()
    } catch {
      // Directorio puede ya existir
    }
  }

  export function generate(input: {
    target: string
    duration: number
    tools: string[]
    findings: Record<string, number>
    recommendations?: string[]
    metadata?: Record<string, unknown>
  }): string {
    const { target, duration, tools, findings, recommendations, metadata } = input

    let md = `# Auditoría de Seguridad - OPENSACIA\n\n`

    // Header
    md += `**Objetivo:** ${target}\n\n`
    md += `**Fecha:** ${new Date().toISOString()}\n\n`
    md += `**Duración:** ${Math.round(duration / 1000)}s\n\n`
    md += `**Herramientas:** ${tools.join(", ")}\n\n`

    // Resumen ejecutivo
    md += `## Resumen Ejecutivo\n\n`
    const totalFindings = Object.values(findings).reduce((a, b) => a + b, 0)
    md += `- Total de hallazgos: ${totalFindings}\n`
    md += `- Críticas: ${findings.critical || 0}\n`
    md += `- Altas: ${findings.high || 0}\n`
    md += `- Medias: ${findings.medium || 0}\n`
    md += `- Bajas: ${findings.low || 0}\n`
    md += `- Info: ${findings.info || 0}\n\n`

    // Recomendaciones
    if (recommendations && recommendations.length > 0) {
      md += `## Recomendaciones\n\n`
      for (let i = 0; i < recommendations.length; i++) {
        md += `${i + 1}. ${recommendations[i]}\n`
      }
      md += "\n"
    }

    // Metadata
    if (metadata) {
      md += `## Metadatos\n\n`
      for (const [key, value] of Object.entries(metadata)) {
        md += `- **${key}:** ${value}\n`
      }
      md += "\n"
    }

    md += `---\n\n`
    md += `*Generado por OPENSACIA - Agente de Ciberseguridad Autónomo*\n`

    return md
  }

  export function save(report: string, path: string): void {
    ensureReportDir()
    const fs = require("fs")
    fs.mkdirSync(require("path").dirname(path), { recursive: true })
    fs.writeFileSync(path, report, "utf-8")
  }

  export function getReportPath(target: string): string {
    const sanitized = target.replace(/[^a-zA-Z0-9.-]/g, "_")
    const date = new Date().toISOString().split("T")[0]
    const filename = `${date}-${sanitized}.md`
    return require("path").join(Flag.OPENSACIA_REPORT_PATH, filename)
  }
}
