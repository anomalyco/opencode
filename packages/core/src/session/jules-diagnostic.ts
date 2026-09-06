export * as JulesDiagnostic from "./jules-diagnostic"

import { spawn, spawnSync } from "node:child_process"
import path from "node:path"
import os from "node:os"
import fs from "node:fs"
import { DateTime, Effect, Layer } from "effect"
import { desc, eq } from "drizzle-orm"
import { Database } from "../database/database"
import { SessionTable, SessionMessageTable } from "./sql"
import { EventV2, type Payload } from "../event"
import { SessionEvent } from "./event"
import { SessionMessage } from "./message"
import { FailurePattern } from "./failure-pattern"
import { makeGlobalNode } from "../effect/app-node"

export const DEFAULT_REPO = "BrandonRaeder/TeamOptiOpencode3"
export const COOLDOWN_MS = 5 * 60 * 1000
export const JULES_DIR = path.join(os.homedir(), ".jules")
export const TRACKED_FILE = path.join(JULES_DIR, "tracked_sessions")
export const STATE_FILE = path.join(JULES_DIR, "monitor_state")
export const LOG_FILE = path.join(JULES_DIR, "jules_monitor.log")

export interface TrackedSession {
  readonly id: string
  readonly workspace: string
}

export interface SessionState {
  readonly status: string
  readonly since: number
}

const recentFailures = new Map<string, number>()

function pruneRecentFailures() {
  const now = Date.now()
  for (const [key, timestamp] of recentFailures) {
    if (now - timestamp > COOLDOWN_MS * 2) {
      recentFailures.delete(key)
    }
  }
}

export function findJulesBinary(): string | undefined {
  const custom = process.env.JULES_BIN
  if (custom && fs.existsSync(custom)) return custom
  const home = os.homedir()
  const candidates = [
    path.join(home, ".npm-global", "bin", "jules"),
    "/home/team/.npm-global/bin/jules",
    "/usr/local/bin/jules",
    "/usr/bin/jules",
  ]
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate
  }
  const which = spawnSync("which", ["jules"], { encoding: "utf8" })
  if (which.status === 0 && which.stdout.trim()) return which.stdout.trim()
  return undefined
}

export function findMonitorScript(workspaceDir: string): string | undefined {
  const custom = process.env.JULES_MONITOR_SCRIPT
  if (custom && fs.existsSync(custom)) return custom
  const userConfigScript = path.join(os.homedir(), ".config", "opencode", "scripts", "jules_monitor.sh")
  if (fs.existsSync(userConfigScript)) return userConfigScript
  const workspaceScript = path.join(workspaceDir, ".opencode", "scripts", "jules_monitor.sh")
  if (fs.existsSync(workspaceScript)) return workspaceScript
  return undefined
}

export function safeExec(command: string, args: string[], cwd: string, maxBytes = 4096): string {
  if (!fs.existsSync(cwd)) return ""
  const result = spawnSync(command, args, { cwd, encoding: "utf8", maxBuffer: maxBytes * 2 })
  if (result.status !== 0 || !result.stdout) return ""
  return result.stdout.trim()
}

export function detectTargetRepo(cwd: string): string {
  const remoteOutput = safeExec("git", ["remote", "-v"], cwd)
  if (!remoteOutput) return DEFAULT_REPO
  if (remoteOutput.includes("TeamOptiOpencode3") || remoteOutput.includes("opencode")) {
    return DEFAULT_REPO
  }
  const match = /(?:github\.com[:/]|git@github\.com:)([a-zA-Z0-9_.-]+)\/([a-zA-Z0-9_.-]+?)(?:\.git)?(?:\s|$)/.exec(
    remoteOutput,
  )
  if (match && match[1] && match[2]) {
    return `${match[1]}/${match[2]}`
  }
  return DEFAULT_REPO
}

export function extractSessionID(output: string): string | undefined {
  const directMatch = /\b(\d{18,20})\b/.exec(output)
  if (directMatch && directMatch[1]) return directMatch[1]
  const urlMatch = /sessions?\/(\d+)/i.exec(output)
  if (urlMatch && urlMatch[1]) return urlMatch[1]
  return undefined
}

export function spawnJulesSession(
  julesBin: string,
  targetRepo: string,
  payload: string,
  cwd: string,
): Promise<string | undefined> {
  return new Promise((resolve) => {
    const child = spawn(julesBin, ["new", "--repo", targetRepo], {
      cwd,
      stdio: ["pipe", "pipe", "pipe"],
    })
    let stdout = ""
    let stderr = ""
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8")
    })
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8")
    })
    child.on("close", (code) => {
      if (code !== 0 && !stdout) {
        resolve(undefined)
        return
      }
      const combined = `${stdout}\n${stderr}`
      resolve(extractSessionID(combined))
    })
    child.on("error", () => {
      resolve(undefined)
    })
    child.stdin.write(payload)
    child.stdin.end()
  })
}

export function buildPayload(input: {
  readonly sessionID: string
  readonly workspace: string
  readonly targetRepo: string
  readonly branch: string
  readonly agent: string
  readonly model: string
  readonly errorMessage: string
  readonly recentLogs: string
  readonly gitStatus: string
  readonly gitDiff: string
}): string {
  return [
    `Diagnose OpenCode failure in repository ${input.targetRepo}`,
    "",
    "### Failure Overview",
    `- **Session ID:** ${input.sessionID}`,
    `- **Workspace:** ${input.workspace}`,
    `- **Active Branch:** ${input.branch || "unknown"}`,
    `- **Agent:** ${input.agent}`,
    `- **Model:** ${input.model}`,
    `- **Timestamp:** ${new Date().toISOString()}`,
    "",
    "### Error Detected During LLM Interaction",
    "```",
    input.errorMessage,
    "```",
    "",
    "### Recent Diagnostic Logs & Session Events",
    input.recentLogs ? input.recentLogs : "(no prior logs recorded)",
    "",
    "### Working Tree Status",
    "```",
    input.gitStatus ? input.gitStatus : "(working tree clean)",
    "```",
    "",
    "### Git Diff Summary",
    "```",
    input.gitDiff ? input.gitDiff : "(no uncommitted diff)",
    "```",
    "",
    "### Instructions for Jules Diagnostic Agent",
    `1. Monitor and track this failure in relation to the OpenCode codebase at ${input.targetRepo}.`,
    "2. Diagnose the exact root cause of the error encountered during LLM interaction, stream processing, or tool execution.",
    "3. Identify the specific files and line numbers in opencode that caused or can fix this issue.",
    "4. Formulate a concrete, actionable fix with code suggestions.",
    "5. Do NOT open a pull request or modify the repository directly; output your diagnostic findings and fix proposal clearly.",
  ].join("\n")
}

export function appendMonitorLog(message: string): void {
  fs.mkdirSync(JULES_DIR, { recursive: true })
  const now = new Date().toISOString().replace("T", " ").replace(/\..+/, "")
  fs.appendFileSync(LOG_FILE, `${now}  ${message}\n`, "utf8")
}

export function trimMonitorLog(maxLines = 400): void {
  if (!fs.existsSync(LOG_FILE)) return
  const lines = fs.readFileSync(LOG_FILE, "utf8").split("\n").filter(Boolean)
  if (lines.length <= maxLines) return
  const trimmed = lines.slice(-maxLines)
  fs.writeFileSync(LOG_FILE, trimmed.join("\n") + "\n", "utf8")
}

export function readMonitorState(): Map<string, SessionState> {
  const map = new Map<string, SessionState>()
  if (!fs.existsSync(STATE_FILE)) return map
  const lines = fs.readFileSync(STATE_FILE, "utf8").split("\n").filter(Boolean)
  for (const line of lines) {
    const parts = line.split(/\s+/)
    if (parts.length >= 3) {
      map.set(parts[0], { status: parts[1], since: Number(parts[2]) || 0 })
    }
  }
  return map
}

export function writeMonitorState(map: Map<string, SessionState>): void {
  fs.mkdirSync(JULES_DIR, { recursive: true })
  const lines: string[] = []
  for (const [id, s] of map) {
    lines.push(`${id} ${s.status} ${s.since}`)
  }
  fs.writeFileSync(STATE_FILE, lines.join("\n") + "\n", "utf8")
}

export function normalizeStatus(raw: string): string {
  const trimmed = raw.trim()
  if (trimmed.startsWith("Awa") || trimmed.startsWith("Awaiting")) return "AWAITING_USER_FEEDBACK"
  if (trimmed.startsWith("In")) return "IN_PROGRESS"
  if (trimmed.startsWith("Com")) return "COMPLETED"
  if (trimmed.startsWith("Pla")) return "PLANNING"
  if (trimmed.startsWith("Fai")) return "FAILED"
  if (trimmed.startsWith("Que")) return "QUEUED"
  if (trimmed.startsWith("Blo")) return "BLOCKED"
  return trimmed || "UNKNOWN"
}

export function parseSessionFromListing(
  listing: string,
  sessionID: string,
): { readonly status: string; readonly repo: string } {
  const lines = listing.split("\n")
  for (const line of lines) {
    if (!line.includes(sessionID.slice(0, 10)) && !line.startsWith(sessionID)) continue
    const cols = line.trim().split(/\s{2,}/)
    if (cols.length >= 5) {
      return {
        repo: cols[2]?.trim() || "",
        status: cols[cols.length - 1]?.trim() || "UNKNOWN",
      }
    }
  }
  return { status: "UNKNOWN", repo: "" }
}

export function trackSession(id: string, workspace: string): boolean {
  fs.mkdirSync(JULES_DIR, { recursive: true })
  const content = fs.existsSync(TRACKED_FILE) ? fs.readFileSync(TRACKED_FILE, "utf8") : ""
  const lines = content.split("\n").map((l) => l.trim()).filter(Boolean)
  const exists = lines.some((l) => l.startsWith(`${id} `) || l === id)
  if (exists) return false
  fs.appendFileSync(TRACKED_FILE, `${id} ${workspace}\n`, "utf8")
  return true
}

export function untrackSession(id: string): boolean {
  if (!fs.existsSync(TRACKED_FILE)) return false
  const content = fs.readFileSync(TRACKED_FILE, "utf8")
  const lines = content.split("\n").filter(Boolean)
  const remaining = lines.filter((l) => !l.startsWith(`${id} `) && l !== id)
  if (remaining.length === lines.length) return false
  fs.writeFileSync(TRACKED_FILE, remaining.length > 0 ? remaining.join("\n") + "\n" : "", "utf8")
  return true
}

export function listTrackedSessions(workspaceFilter?: string): TrackedSession[] {
  if (!fs.existsSync(TRACKED_FILE)) return []
  const content = fs.readFileSync(TRACKED_FILE, "utf8")
  const lines = content.split("\n").map((l) => l.trim()).filter(Boolean)
  const list: TrackedSession[] = []
  for (const line of lines) {
    const parts = line.split(/\s+/)
    if (parts.length === 0 || !parts[0]) continue
    const id = parts[0]
    const workspace = parts[1] || process.cwd()
    if (workspaceFilter && workspace !== workspaceFilter) continue
    list.push({ id, workspace })
  }
  return list
}

export function pollTrackedSessions(): {
  readonly checked: number
  readonly transitions: number
  readonly stuck: number
} {
  fs.mkdirSync(JULES_DIR, { recursive: true })
  const julesBin = findJulesBinary()
  if (!julesBin) {
    appendMonitorLog("FATAL  jules CLI not found")
    return { checked: 0, transitions: 0, stuck: 0 }
  }
  const tracked = listTrackedSessions()
  if (tracked.length === 0) return { checked: 0, transitions: 0, stuck: 0 }

  const listing = safeExec(julesBin, ["remote", "list", "--session"], process.cwd(), 65536)
  const state = readMonitorState()
  const now = Math.floor(Date.now() / 1000)
  let transitions = 0
  let stuckCount = 0

  for (const item of tracked) {
    const parsed = parseSessionFromListing(listing, item.id)
    const status = normalizeStatus(parsed.status)
    const repo = parsed.repo
    const ctx = repo ? ` (${repo})` : ""
    const prevState = state.get(item.id)
    const prevStatus = prevState ? prevState.status : "UNKNOWN"

    if (prevStatus !== status) {
      transitions++
      appendMonitorLog(`TRANSITION  ${item.id}${ctx}: ${prevStatus} -> ${status}`)
      state.set(item.id, { status, since: now })
    } else if (!prevState) {
      state.set(item.id, { status, since: now })
    }

    const current = state.get(item.id)
    if (current && (current.status === "AWAITING_USER_FEEDBACK" || current.status === "FAILED")) {
      const ageMinutes = Math.floor((now - current.since) / 60)
      if (ageMinutes >= 15) {
        stuckCount++
        appendMonitorLog(`STUCK>=${ageMinutes}m  ${item.id}${ctx}  status=${current.status} (needs nudge/resolve)`)
      }
    }
    if (status === "COMPLETED") {
      appendMonitorLog(`COMPLETED     ${item.id}${ctx} (check PR link)`)
    }
  }

  const trackedSet = new Set(tracked.map((t) => t.id))
  for (const key of state.keys()) {
    if (!trackedSet.has(key)) state.delete(key)
  }
  writeMonitorState(state)
  trimMonitorLog(400)

  return { checked: tracked.length, transitions, stuck: stuckCount }
}

async function runDiagnostic(
  event: Payload<typeof SessionEvent.Step.Failed>,
  db: Database.Interface["db"],
  events: EventV2.Interface,
) {
  if (process.env.OPENCODE_DISABLE_JULES === "1" || process.env.NODE_ENV === "test") return
  pruneRecentFailures()
  const errorSignature = `${event.data.sessionID}:${event.data.error.message}`
  const lastSeen = recentFailures.get(errorSignature)
  if (lastSeen && Date.now() - lastSeen < COOLDOWN_MS) return
  recentFailures.set(errorSignature, Date.now())

  const resolution = FailurePattern.lookupResolution(event.data.error.message)
  if (resolution) {
    FailurePattern.applyResolutionToSession(event.data.sessionID, resolution)
    const now = await Effect.runPromise(DateTime.now)
    await Effect.runPromise(
      events.publish(SessionEvent.Log.Ended, {
        sessionID: event.data.sessionID,
        timestamp: now,
        assistantMessageID: event.data.assistantMessageID,
        logID: SessionMessage.ID.create(),
        text: `[Auto-Healing]: Known failure pattern recognized: ${resolution.name}. Applied resolution: ${resolution.recommendedAction}`,
      }),
    )
    return
  }

  const julesBin = findJulesBinary()
  if (!julesBin) {
    await Effect.runPromise(Effect.logWarning("Jules CLI binary not found; skipping automated diagnostic spawn"))
    return
  }

  const session = await Effect.runPromise(
    db
      .select()
      .from(SessionTable)
      .where(eq(SessionTable.id, event.data.sessionID))
      .get()
      .pipe(Effect.orDie),
  )
  if (!session) return

  const workspace = session.directory && fs.existsSync(session.directory) ? session.directory : process.cwd()
  const branch =
    safeExec("git", ["branch", "--show-current"], workspace) ||
    safeExec("git", ["rev-parse", "--abbrev-ref", "HEAD"], workspace)
  const targetRepo = detectTargetRepo(workspace)
  const gitStatus = safeExec("git", ["status", "--short"], workspace)
  const gitDiff = safeExec("git", ["diff", "HEAD", "--stat"], workspace)

  const recentRows = await Effect.runPromise(
    db
      .select()
      .from(SessionMessageTable)
      .where(eq(SessionMessageTable.session_id, event.data.sessionID))
      .orderBy(desc(SessionMessageTable.seq))
      .limit(6)
      .all()
      .pipe(Effect.orDie),
  )

  const recentLogLines: string[] = []
  for (const row of recentRows.reverse()) {
    if (
      row.type === "assistant" &&
      row.data &&
      typeof row.data === "object" &&
      "content" in row.data &&
      Array.isArray(row.data.content)
    ) {
      for (const part of row.data.content) {
        if (part && typeof part === "object" && part.type === "log" && typeof part.text === "string") {
          recentLogLines.push(`[+log] ${part.text}`)
        }
      }
    } else if (
      row.type === "user" &&
      row.data &&
      typeof row.data === "object" &&
      "text" in row.data &&
      typeof row.data.text === "string"
    ) {
      recentLogLines.push(`[user] ${row.data.text.slice(0, 300)}`)
    }
  }

  const modelName = session.model ? `${session.model.providerID}/${session.model.id}` : "unknown"

  const payload = buildPayload({
    sessionID: event.data.sessionID,
    workspace,
    targetRepo,
    branch,
    agent: session.agent ?? "default",
    model: modelName,
    errorMessage: event.data.error.message,
    recentLogs: recentLogLines.join("\n"),
    gitStatus,
    gitDiff,
  })

  const julesSessionID = await spawnJulesSession(julesBin, targetRepo, payload, workspace)
  if (!julesSessionID) {
    await Effect.runPromise(
      Effect.logWarning("Automated Jules diagnostic spawn completed without a session ID", {
        sessionID: event.data.sessionID,
        targetRepo,
      }),
    )
    return
  }

  trackSession(julesSessionID, workspace)

  const monitorScript = findMonitorScript(workspace)
  if (monitorScript) {
    spawnSync("bash", [monitorScript, "add", julesSessionID, workspace], { encoding: "utf8" })
  }

  const now = await Effect.runPromise(DateTime.now)
  await Effect.runPromise(
    events.publish(SessionEvent.Log.Ended, {
      sessionID: event.data.sessionID,
      timestamp: now,
      assistantMessageID: event.data.assistantMessageID,
      logID: SessionMessage.ID.create(),
      text: `[Jules Diagnostic Agent Spawned: session ${julesSessionID} (${targetRepo}) - tracking and diagnosing LLM error]`,
    }),
  )

  await Effect.runPromise(
    Effect.logInfo("Automated Jules diagnostic session spawned", {
      sessionID: event.data.sessionID,
      julesSessionID,
      targetRepo,
    }),
  )
}

const layer = Layer.effectDiscard(
  Effect.gen(function* () {
    const events = yield* EventV2.Service
    const { db } = yield* Database.Service
    yield* events.listen((event) => {
      if (event.type === SessionEvent.Step.Failed.type) {
        setImmediate(() => {
          runDiagnostic(event as Payload<typeof SessionEvent.Step.Failed>, db, events).catch(() => {})
        })
      }
      return Effect.void
    })
  }),
)

export const node = makeGlobalNode({
  name: "jules-diagnostic",
  layer,
  deps: [EventV2.node, Database.node],
})
