import path from "path"
import fs from "fs/promises"
import os from "os"
import { Global } from "@opencode-ai/core/global"
import { ensureRunID } from "@opencode-ai/core/util/opencode-process"

const HEARTBEAT_DIR = path.join(Global.Path.data, "instances")

const STALE_MS = 48 * 60 * 60 * 1000

type HeartbeatData = {
  pid: number
  started_at: number
  directory: string
  hostname: string
}

let heartbeatFile: string | null = null

export const Severity = {
  Fine: "fine",
  Mild: "mild",
  Concerned: "concerned",
  Worried: "worried",
  Urgent: "urgent",
} as const

export type Severity = (typeof Severity)[keyof typeof Severity]

export type CheckResult = {
  severity: Severity
  liveCount: number
  myAgeHours: number
  oldestAgeHours: number
  message: string
}

export async function initHeartbeat(): Promise<void> {
  const id = ensureRunID()
  heartbeatFile = path.join(HEARTBEAT_DIR, `${id}.json`)

  const data: HeartbeatData = {
    pid: process.pid,
    started_at: Date.now(),
    directory: process.cwd(),
    hostname: os.hostname(),
  }

  await fs.mkdir(HEARTBEAT_DIR, { recursive: true })
  await fs.writeFile(heartbeatFile, JSON.stringify(data))

  const cleanup = () => cleanupHeartbeat()
  process.once("exit", cleanup)
  process.once("SIGTERM", () => {
    cleanup()
    process.exit()
  })
}

export function cleanupHeartbeat(): void {
  if (heartbeatFile) {
    fs.unlink(heartbeatFile).catch(() => {})
    heartbeatFile = null
  }
}

function severityMessage(
  severity: Severity,
  liveCount: number,
  hours: number,
): string {
  switch (severity) {
    case Severity.Mild:
      if (liveCount >= 3) {
        return `You have ${liveCount} instances of opencode running. Everything okay?`
      }
      return `You've been running opencode for ${Math.round(hours)} hours. Might be time for a break.`
    case Severity.Concerned:
      if (liveCount >= 5) {
        return `That's ${liveCount} instances of opencode running. You might want to step away for a bit.`
      }
      return `You've been at this for ${Math.round(hours)} hours. Just a friendly check-in.`
    case Severity.Worried:
      if (liveCount >= 8) {
        return `We're genuinely concerned. You have ${liveCount} instances running and it's been ${Math.round(hours)} hours. Please take a break.`
      }
      return `This is getting concerning. ${Math.round(hours)} hours straight. The code will still be there tomorrow.`
    case Severity.Urgent:
      return `This is a wellness check. You have ${liveCount} instances of opencode running and you've been going for ${Math.round(hours)} hours. We strongly recommend you step away and talk to someone.`
    default:
      return ""
  }
}

export async function checkHeartbeat(
  maxInstances: number = 3,
  maxHours: number = 12,
): Promise<CheckResult> {
  let files: string[]
  try {
    files = await fs.readdir(HEARTBEAT_DIR)
  } catch {
    return {
      severity: Severity.Fine,
      liveCount: 0,
      myAgeHours: 0,
      oldestAgeHours: 0,
      message: "",
    }
  }

  const now = Date.now()
  const heartbeats: HeartbeatData[] = []
  const myID = ensureRunID()
  let myAge = 0

  for (const file of files) {
    if (!file.endsWith(".json")) continue

    try {
      const content = await fs.readFile(path.join(HEARTBEAT_DIR, file), "utf-8")
      const data: HeartbeatData = JSON.parse(content)

      if (now - data.started_at > STALE_MS) continue

      heartbeats.push(data)

      const id = file.replace(".json", "")
      if (id === myID) {
        myAge = now - data.started_at
      }
    } catch {
      continue
    }
  }

  if (heartbeats.length === 0) {
    return {
      severity: Severity.Fine,
      liveCount: 0,
      myAgeHours: 0,
      oldestAgeHours: 0,
      message: "",
    }
  }

  const oldestAge = Math.max(...heartbeats.map((h) => now - h.started_at))
  const myHours = myAge / (1000 * 60 * 60)
  const oldestHours = oldestAge / (1000 * 60 * 60)
  const count = heartbeats.length

  const severity = ((): Severity => {
    if (count >= 10 || oldestHours >= maxHours * 4) return Severity.Urgent
    if (count >= 8 || oldestHours >= maxHours * 2) return Severity.Worried
    if (count >= 5 || oldestHours >= maxHours) return Severity.Concerned
    if (count >= maxInstances || myHours >= maxHours) return Severity.Mild
    return Severity.Fine
  })()

  return {
    severity,
    liveCount: count,
    myAgeHours: myHours,
    oldestAgeHours: oldestHours,
    message: severityMessage(severity, count, oldestHours),
  }
}
