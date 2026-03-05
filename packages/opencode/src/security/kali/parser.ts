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
