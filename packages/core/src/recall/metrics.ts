// M7: JSONL metrics logger for recall events.
// Writes to OPENCODE_RECALL_METRICS_PATH or default <XDG_DATA_HOME>/opencode/logs/recall-metrics.jsonl.
// Sprint 4 fix: write immediately per event (no throttle). Each event is 100-200 bytes;
// 1000 events = 200KB total. Trivial for disk. Throttle was hiding the file
// when nssm stopped the service (nssm doesn't send SIGTERM to the child process).

import { appendFileSync, mkdirSync, existsSync } from "node:fs"
import { dirname, join } from "node:path"
import { homedir } from "node:os"

let resolvedPath: string | null = null

function resolvePath(): string {
  if (resolvedPath) return resolvedPath
  const envPath = process.env["OPENCODE_RECALL_METRICS_PATH"]
  if (envPath) {
    resolvedPath = envPath
  } else {
    const xdgData = process.env["XDG_DATA_HOME"] || join(homedir(), ".local", "share")
    const dir = join(xdgData, "opencode", "logs")
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    resolvedPath = join(dir, "recall-metrics.jsonl")
  }
  const dir = dirname(resolvedPath)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return resolvedPath
}

export type RecallEvent =
  | "indexed"
  | "invoked"
  | "cache_hit"
  | "cache_miss"
  | "regex_inject"
  | "semantic_inject"

export interface MetricData {
  evt: RecallEvent
  qid?: string
  score?: number
  dur_ms?: number
  limit?: number
  hit_count?: number
  system_chars?: number
  recall_chars?: number
  [key: string]: unknown
}

export function appendMetric(data: MetricData): void {
  const line = JSON.stringify({ ts: new Date().toISOString(), ...data }) + "\n"
  try {
    appendFileSync(resolvePath(), line)
  } catch (e) {
    // Silently fail — metrics are best-effort
  }
}
