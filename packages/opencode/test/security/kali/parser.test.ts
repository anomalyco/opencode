// packages/opencode/test/security/kali/parser.test.ts
import { describe, test, expect } from "bun:test"
import { NmapParser } from "@/security/kali/parser"

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
