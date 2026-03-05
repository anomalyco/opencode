// packages/opencode/test/security/kali/parser.test.ts
import { describe, test, expect } from "bun:test"
import { NmapParser, NucleiParser } from "@/security/kali/parser"

describe("NmapParser", () => {
  test("parsea output básico de nmap", () => {
    const output = `
Starting Nmap 7.94 ( https://nmap.org )
Nmap scan report for 192.168.1.1
Host is up (0.0023s latency).
PORT   STATE SERVICE
22/tcp open  ssh
80/tcp open  http
`
    const result = NmapParser.parse(output)
    expect(result.hosts).toHaveLength(1)
    expect(result.hosts[0].ip).toBe("192.168.1.1")
    expect(result.hosts[0].ports).toHaveLength(2)
  })

  test("extrae servicios detectados", () => {
    const output = `
Nmap scan report for 192.168.1.1
PORT     STATE SERVICE VERSION
22/tcp   open  ssh     OpenSSH 8.9
443/tcp  open  https   nginx 1.18.0
`
    const result = NmapParser.parse(output)
    expect(result.hosts[0].ports[0].service).toBe("ssh")
    expect(result.hosts[0].ports[0].version).toBe("OpenSSH 8.9")
  })

  test("genera markdown correctamente", () => {
    const result = {
      hosts: [
        {
          ip: "192.168.1.1",
          state: "up",
          ports: [
            { port: 22, protocol: "tcp", state: "open", service: "ssh", version: "OpenSSH 8.9" },
            { port: 80, protocol: "tcp", state: "open", service: "http" },
          ],
        },
      ],
    }
    const md = NmapParser.toMarkdown(result)
    expect(md).toContain("## Resultados Nmap")
    expect(md).toContain("192.168.1.1")
    expect(md).toContain("| 22 |")
  })
})

describe("NucleiParser", () => {
  test("parsea output JSON de nuclei", () => {
    const jsonOutput = JSON.stringify([
      {
        template: "cves/2021/CVE-2021-22204.yaml",
        templateID: "CVE-2021-22204",
        info: {
          name: "ExifTool CVE-2021-22204",
          severity: "critical",
        },
        host: "http://example.com",
        matched: "http://example.com",
      },
    ])

    const result = NucleiParser.parse(jsonOutput)
    expect(result.findings).toHaveLength(1)
    expect(result.findings[0].severity).toBe("critical")
  })

  test("genera markdown agrupado por severidad", () => {
    const result = {
      findings: [
        {
          template: "cves/2021/CVE-2021-22204.yaml",
          templateID: "CVE-2021-22204",
          name: "ExifTool CVE-2021-22204",
          severity: "critical",
          host: "http://example.com",
          matched: "http://example.com",
        },
        {
          template: "exposures/configs/api-key.yaml",
          templateID: "api-key-exposure",
          name: "API Key Exposure",
          severity: "high",
          host: "http://example.com",
          matched: "http://example.com/api/key",
        },
      ],
    }
    const md = NucleiParser.toMarkdown(result)
    expect(md).toContain("## Resultados Nuclei")
    expect(md).toContain("### CRITICAL")
    expect(md).toContain("### HIGH")
    expect(md).toContain("ExifTool CVE-2021-22204")
  })
})
