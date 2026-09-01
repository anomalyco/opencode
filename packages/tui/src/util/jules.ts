import { readFile } from "node:fs/promises"
import path from "node:path"
import { Global } from "@opencode-ai/core/global"

export type JulesJob = {
  id: string
  workspace: string | undefined
  status: string | undefined
  since: number | undefined
}

export type JulesMonitor = {
  jobs: JulesJob[]
  log: string[]
}

const STATUS = new Set([
  "AWAITING_USER_FEEDBACK",
  "IN_PROGRESS",
  "COMPLETED",
  "PLANNING",
  "FAILED",
  "QUEUED",
  "BLOCKED",
])

function julesDir() {
  return path.join(Global.Path.home, ".jules")
}

export function isJulesStatus(status: string | undefined): status is NonNullable<JulesJob["status"]> {
  return status !== undefined && STATUS.has(status)
}

export async function readJulesMonitor(): Promise<JulesMonitor> {
  const dir = julesDir()
  const [tracked, state, log] = await Promise.all([
    readFile(path.join(dir, "tracked_sessions"), "utf8").catch(() => ""),
    readFile(path.join(dir, "monitor_state"), "utf8").catch(() => ""),
    readFile(path.join(dir, "jules_monitor.log"), "utf8").catch(() => ""),
  ])

  const seen = new Map<string, { status: string; since: number | undefined }>()
  for (const line of state.split("\n")) {
    const [id, status, since] = line.trim().split(/\s+/)
    if (!id) continue
    seen.set(id, { status: status ?? "UNKNOWN", since: since ? Number(since) : undefined })
  }

  const jobs: JulesJob[] = []
  for (const line of tracked.split("\n")) {
    const [id, workspace] = line.trim().split(/\s+/)
    if (!id) continue
    const entry = seen.get(id)
    jobs.push({
      id,
      workspace,
      status: entry?.status,
      since: entry?.since,
    })
  }

  return {
    jobs,
    log: log.split("\n").filter((line) => line.trim().length > 0).slice(-10),
  }
}

export function ageMinutes(since: number | undefined, now = Date.now() / 1000) {
  if (since === undefined) return undefined
  return Math.max(0, Math.floor((now - since) / 60))
}