import { PlanStore } from "./plan"
import { Log } from "@/util/log"
import * as fs from "fs/promises"
import type { Plan, PlanID, WorkerState, WorkerStatus } from "./schema"

export interface DiagnosticsBundle {
  plan: {
    id: PlanID
    projectID: string
    sessionID?: string
    status: string
    task: string
    orchestratorModel: { providerID: string; modelID: string }
    workerModel: { providerID: string; modelID: string }
    subtasks: Array<{
      id: string
      title: string
      description: string
      fileScope: string[]
      dependencies: string[]
      model?: { providerID: string; modelID: string }
    }>
    time: {
      created: number
      approved?: number
      completed?: number
    }
  }
  error?: {
    code: string
    message: string
    stage: string
    at: number
  }
  workers: {
    summary: Record<WorkerStatus, number>
    list: Array<{
      subtaskID: string
      status: WorkerStatus
      sessionID?: string
      worktreeName?: string
      worktreeDir?: string
      branch?: string
      error?: string
      diffStat?: { additions: number; deletions: number; files: number }
    }>
  }
  logs: Array<{
    timestamp: string
    level: string
    service?: string
    message: string
    extra?: Record<string, any>
  }>
  exportedAt: number
}

const SENSITIVE_PATTERNS = [
  { pattern: /sk-[a-zA-Z0-9]{5,}/g, replacement: "***REDACTED***" },
  { pattern: /token[:=]\s*([^\s",}]+)/gi, replacement: "token: ***REDACTED***" },
  { pattern: /secret[:=]\s*([^\s",}]+)/gi, replacement: "secret: ***REDACTED***" },
  { pattern: /password[:=]\s*([^\s",}]+)/gi, replacement: "password: ***REDACTED***" },
  { pattern: /api[_-]?key[:=]\s*([^\s",}]+)/gi, replacement: "apiKey: ***REDACTED***" },
]

function sanitizeString(value: string): string {
  let result = value
  for (const { pattern, replacement } of SENSITIVE_PATTERNS) {
    result = result.replace(pattern, replacement)
  }
  return result
}

function sanitizeBundle(bundle: DiagnosticsBundle): DiagnosticsBundle {
  const json = JSON.stringify(bundle)
  const sanitized = sanitizeString(json)
  return JSON.parse(sanitized) as DiagnosticsBundle
}

function parseLogLine(
  line: string,
): { timestamp: string; level: string; message: string; service?: string; extra?: Record<string, any> } | null {
  const match = line.match(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})\s+(\w+)\s+(.+)$/)
  if (!match) return null
  const timestamp = match[1]
  const level = match[2]
  const rest = match[3]
  const serviceMatch = rest.match(/^service=(\S+)\s+(.+)$/)
  let service: string | undefined
  let message = rest
  let extra: Record<string, any> | undefined
  if (serviceMatch) {
    service = serviceMatch[1]
    message = serviceMatch[2]
  }
  const extraMatch = message.match(/^(.*?)\s+(\w+=.+)$/)
  if (extraMatch) {
    message = extraMatch[1].trim()
    const extraPart = extraMatch[2]
    extra = {}
    const pairs = extraPart.match(/(\w+)=((?:"[^"]*"|\S+))/g)
    if (pairs) {
      for (const pair of pairs) {
        const eqIndex = pair.indexOf("=")
        if (eqIndex > 0) {
          const key = pair.slice(0, eqIndex)
          let val = pair.slice(eqIndex + 1)
          if (val.startsWith('"') && val.endsWith('"')) {
            val = val.slice(1, -1)
          }
          extra[key] = val
        }
      }
    }
  }
  return { timestamp, level, message, service, extra }
}

async function collectLogsForPlan(planID: PlanID): Promise<DiagnosticsBundle["logs"]> {
  const logs: DiagnosticsBundle["logs"] = []
  const logFile = Log.file()
  if (!logFile) return logs
  try {
    const content = await fs.readFile(logFile, "utf-8")
    const lines = content.split("\n").filter((line) => line.trim())
    for (const line of lines) {
      if (!line.includes(planID)) continue
      const parsed = parseLogLine(line)
      if (parsed) {
        logs.push({
          timestamp: parsed.timestamp,
          level: parsed.level,
          service: parsed.service,
          message: parsed.message,
          extra: parsed.extra,
        })
      }
    }
  } catch {
    // Log file not accessible
  }
  return logs.slice(-100)
}

export async function exportDiagnosticsBundle(planID: PlanID): Promise<DiagnosticsBundle> {
  const plan = await PlanStore.get(planID)
  const workerSummary: Record<WorkerStatus, number> = {
    pending: 0,
    spawning: 0,
    running: 0,
    stopping: 0,
    done: 0,
    failed: 0,
    merged: 0,
    conflict: 0,
  }
  for (const worker of plan.workers) {
    workerSummary[worker.status]++
  }
  const logs = await collectLogsForPlan(planID)
  const bundle: DiagnosticsBundle = {
    plan: {
      id: plan.id,
      projectID: plan.projectID,
      sessionID: plan.sessionID,
      status: plan.status,
      task: plan.task,
      orchestratorModel: plan.orchestratorModel,
      workerModel: plan.workerModel,
      subtasks: plan.subtasks,
      time: plan.time,
    },
    error: plan.error,
    workers: {
      summary: workerSummary,
      list: plan.workers,
    },
    logs,
    exportedAt: Date.now(),
  }
  return sanitizeBundle(bundle)
}
