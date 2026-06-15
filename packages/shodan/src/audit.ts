import { appendFile, mkdir } from "node:fs/promises"
import { join } from "node:path"
import { homedir } from "node:os"

export interface ShodanAuditEntry {
  timestamp: string
  operation: string
  query?: string
  ip?: string
  params?: Record<string, unknown>
  sessionId?: string
  userId?: string
  approved: boolean
}

const AUDIT_DIR = join(homedir(), ".daemoncode", "audit")
const AUDIT_FILE = join(AUDIT_DIR, "shodan.ndjson")

export async function auditLog(entry: ShodanAuditEntry): Promise<void> {
  try {
    await mkdir(AUDIT_DIR, { recursive: true })
    const line = JSON.stringify({ ...entry, timestamp: new Date().toISOString() }) + "\n"
    await appendFile(AUDIT_FILE, line, "utf8")
  } catch {
    // Audit failure must never crash the tool — log to stderr only
    console.error("[shodan:audit] Failed to write audit log:", entry)
  }
}

export function buildAuditEntry(
  operation: string,
  params: Record<string, unknown>,
  approved: boolean,
  context?: { sessionId?: string; userId?: string },
): ShodanAuditEntry {
  return {
    timestamp: new Date().toISOString(),
    operation,
    params,
    approved,
    sessionId: context?.sessionId,
    userId: context?.userId,
    ...(params.query ? { query: String(params.query) } : {}),
    ...(params.ip ? { ip: String(params.ip) } : {}),
  }
}
