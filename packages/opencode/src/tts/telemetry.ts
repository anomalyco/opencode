import * as fs from "node:fs"
import * as path from "node:path"
import { Global } from "@/global"

// Metadata only — never log spoken text
export type TTSEvent = {
  timestamp: string
  event: string
  sessionID: string
  messageID: string
  partID?: string
  reason?: string
  duration?: number
  queueLength?: number
  error?: string
}

const MAX = 10 * 1024 * 1024 // 10MB

function logPath() {
  return path.join(Global.Path.data, "tts-telemetry.jsonl")
}

export function logTTSEvent(evt: TTSEvent): void {
  const target = logPath()
  fs.mkdirSync(path.dirname(target), { recursive: true })
  try {
    const stat = fs.statSync(target)
    if (stat.size > MAX) {
      fs.renameSync(target, target + ".1")
    }
  } catch {}
  fs.appendFileSync(target, JSON.stringify(evt) + "\n", "utf8")
}
