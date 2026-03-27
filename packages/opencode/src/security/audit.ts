// SEC-04: No external call sites found as of 2026-03-26. Guard is in module itself.
import fs from "fs/promises"
import path from "path"
import { Global } from "../global"
import { Config } from "../config/config"

export interface AuditEntry {
  timestamp: string
  type: string
  data: Record<string, unknown>
  hash: string
}

async function sha256(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input)
  const buf = await crypto.subtle.digest("SHA-256", bytes)
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
}

export class AuditLog {
  constructor(private readonly filePath: string) {}

  async log(event: { type: string; data: Record<string, unknown> }): Promise<void> {
    const cfg = await Config.get()
    if (cfg.security?.auditLog?.enabled === false) return

    await fs.mkdir(path.dirname(this.filePath), { recursive: true })

    let prevHash = ""
    try {
      const contents = await fs.readFile(this.filePath, "utf8")
      const lines = contents.trim().split("\n").filter(Boolean)
      if (lines.length > 0) {
        const last = JSON.parse(lines[lines.length - 1]) as AuditEntry
        prevHash = last.hash
      }
    } catch {}

    const entry: AuditEntry = {
      timestamp: new Date().toISOString(),
      type: event.type,
      data: event.data,
      hash: await sha256(prevHash + event.type + JSON.stringify(event.data)),
    }

    await fs.appendFile(this.filePath, JSON.stringify(entry) + "\n", "utf8")
  }

  async getEntries(): Promise<AuditEntry[]> {
    try {
      const contents = await fs.readFile(this.filePath, "utf8")
      return contents
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line) as AuditEntry)
    } catch {
      return []
    }
  }
}

export const defaultAuditLog = new AuditLog(path.join(Global.Path.data, "audit.log"))
