// packages/opencode/src/security/kali/parser.ts

export interface Port {
  port: number
  protocol: string
  state: string
  service?: string
  version?: string
}

export interface Host {
  ip: string
  hostname?: string
  state: string
  ports: Port[]
  os?: string[]
}

export interface NmapResult {
  hosts: Host[]
  command?: string
}

export namespace NmapParser {
  export function parse(output: string): NmapResult {
    const hosts: Host[] = []
    const lines = output.split("\n")

    let currentHost: Host | null = null

    for (const line of lines) {
      // Detectar nuevo host
      const hostMatch = line.match(/Nmap scan report for ([^\s]+)/)
      if (hostMatch) {
        if (currentHost) {
          hosts.push(currentHost)
        }
        currentHost = {
          ip: hostMatch[1],
          state: "up",
          ports: [],
        }
        continue
      }

      // Detectar estado del host
      if (line.includes("Host is up")) {
        if (currentHost) currentHost.state = "up"
      }

      // Detectar puerto
      const portMatch = line.match(/(\d+)\/(\w+)\s+(\w+)\s+(\w+)(?:\s+(.+))?/)
      if (portMatch && currentHost) {
        const port: Port = {
          port: parseInt(portMatch[1]),
          protocol: portMatch[2],
          state: portMatch[3],
          service: portMatch[4],
        }
        if (portMatch[5]) {
          port.version = portMatch[5].trim()
        }
        currentHost.ports.push(port)
      }

      // Detectar OS
      if (line.includes("OS details:") && currentHost) {
        currentHost.os = currentHost.os || []
        const os = line.replace(/.*OS details:\s*/, "").trim()
        currentHost.os.push(os)
      }
    }

    if (currentHost) {
      hosts.push(currentHost)
    }

    return { hosts }
  }

  export function toMarkdown(result: NmapResult): string {
    let md = "## Resultados Nmap\n\n"

    for (const host of result.hosts) {
      md += `### Host: ${host.ip}\n\n`
      md += `- Estado: ${host.state}\n`

      if (host.hostname) {
        md += `- Hostname: ${host.hostname}\n`
      }

      if (host.os && host.os.length > 0) {
        md += `- OS: ${host.os.join(", ")}\n`
      }

      md += "\n#### Puertos Abiertos\n\n"
      md += "| Puerto | Protocolo | Estado | Servicio | Versión |\n"
      md += "|--------|-----------|--------|----------|--------|\n"

      for (const port of host.ports) {
        md += `| ${port.port} | ${port.protocol} | ${port.state} | ${port.service || "-"} | ${port.version || "-"} |\n`
      }

      md += "\n"
    }

    return md
  }
}

export interface Finding {
  template: string
  templateID: string
  name: string
  severity: string
  host: string
  matched: string
  tags?: string[]
}

export interface NucleiResult {
  findings: Finding[]
}

export namespace NucleiParser {
  export function parse(output: string): NucleiResult {
    const findings: Finding[] = []

    try {
      // Nuclei puede output JSON o texto
      if (output.trim().startsWith("[")) {
        const parsed = JSON.parse(output) as any[]
        for (const item of parsed) {
          // Nuclei JSON output tiene info.severity, info.name
          findings.push({
            template: item.template || "",
            templateID: item.templateID || item["template-id"] || "",
            name: item.info?.name || item.name || "",
            severity: item.info?.severity || item.severity || "unknown",
            host: item.host || "",
            matched: item.matched || item.host || "",
            tags: item.info?.tags || item.tags || [],
          })
        }
      } else {
        // Parsear formato de texto
        const lines = output.split("\n")
        for (const line of lines) {
          if (line.includes("[") && line.includes("]")) {
            // Formato: [severity] [id] name
            const parts = line.split(/\s+/)
            // Implementación básica
          }
        }
      }
    } catch {
      // Si falla el parseo JSON, retornar vacío
    }

    return { findings }
  }

  export function toMarkdown(result: NucleiResult): string {
    let md = "## Resultados Nuclei\n\n"

    const grouped = result.findings.reduce((acc, f) => {
      if (!acc[f.severity]) acc[f.severity] = []
      acc[f.severity].push(f)
      return acc
    }, {} as Record<string, Finding[]>)

    const severityOrder = ["critical", "high", "medium", "low", "info"]

    for (const severity of severityOrder) {
      if (!grouped[severity]) continue

      md += `### ${severity.toUpperCase()} (${grouped[severity].length})\n\n`

      for (const finding of grouped[severity]) {
        md += `- **${finding.name}** (${finding.templateID})\n`
        md += `  - Host: ${finding.host}\n`
        md += `  - Template: ${finding.template}\n`
        if (finding.tags && finding.tags.length > 0) {
          md += `  - Tags: ${finding.tags.join(", ")}\n`
        }
        md += "\n"
      }
    }

    return md
  }
}
