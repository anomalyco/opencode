import path from "path"
import fs from "fs"

type AuditEvent = {
  ts: number
  agent: string
  action: string
  target?: string
  details?: Record<string, unknown>
}

export class AuditLogger {
  private filePath: string

  constructor(dir: string) {
    this.filePath = path.join(dir, "audit.jsonl")
  }

  async init(): Promise<void> {
    await fs.promises.mkdir(path.dirname(this.filePath), { recursive: true })
    if (!fs.existsSync(this.filePath)) {
      await fs.promises.writeFile(this.filePath, "")
    }
  }

  async append(event: Omit<AuditEvent, "ts">): Promise<void> {
    const full: AuditEvent = { ts: Date.now(), ...event }
    const line = JSON.stringify(full) + "\n"
    await fs.promises.appendFile(this.filePath, line)
  }

  async read(options?: {
    agent?: string
    action?: string
    since?: number
    until?: number
    limit?: number
  }): Promise<AuditEvent[]> {
    let content: string
    try {
      content = await fs.promises.readFile(this.filePath, "utf-8")
    } catch {
      return []
    }
    let events = content
      .split("\n")
      .filter((l) => l.trim())
      .map((l) => JSON.parse(l) as AuditEvent)
    if (options?.agent) events = events.filter((e) => e.agent === options.agent)
    if (options?.action) events = events.filter((e) => e.action === options.action)
    if (options?.since) events = events.filter((e) => e.ts >= options.since!)
    if (options?.until) events = events.filter((e) => e.ts <= options.until!)
    if (options?.limit) events = events.slice(-options.limit)
    return events
  }

  async readByAgent(agentId: string): Promise<AuditEvent[]> {
    return this.read({ agent: agentId })
  }
}
