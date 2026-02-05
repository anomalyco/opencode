import { Log } from "../util/log"
import * as fs from "fs/promises"
import * as path from "path"
import { Global } from "../global"

const log = Log.create({ service: "audit" })

export namespace AuditLog {
  interface Entry {
    timestamp: string
    action: string
    details: Record<string, unknown>
    source: string
  }

  const buffer: Entry[] = []
  const MAX_BUFFER = 100

  export function record(action: string, details: Record<string, unknown>, source = "system") {
    const entry: Entry = {
      timestamp: new Date().toISOString(),
      action,
      details,
      source,
    }

    log.info("audit", entry)
    buffer.push(entry)

    if (buffer.length >= MAX_BUFFER) {
      flush().catch(() => {})
    }
  }

  export async function flush() {
    if (buffer.length === 0) return
    const entries = buffer.splice(0)
    const auditDir = path.join(Global.Path.data, "audit")
    await fs.mkdir(auditDir, { recursive: true })
    const filename = `audit-${new Date().toISOString().replace(/[:.]/g, "-")}.jsonl`
    const content = entries.map((e) => JSON.stringify(e)).join("\n") + "\n"
    await fs.appendFile(path.join(auditDir, filename), content)
  }
}
