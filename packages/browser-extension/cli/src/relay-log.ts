import { dataRoot } from "./paths.ts"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

const maxLogBytes = 1_000_000
const maxEntryCharacters = 64_000

export function managedRelayLogPath(home = os.homedir()): string {
  return path.join(dataRoot(home), "logs", "relay.log")
}

export function appendManagedRelayProcessLog(message: string, home = os.homedir()): void {
  try {
    const logPath = managedRelayLogPath(home)
    const directory = path.dirname(logPath)
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 })
    fs.chmodSync(directory, 0o700)
    const entry = `${new Date().toISOString()} ${message.slice(0, maxEntryCharacters)}\n`
    const stat = fs.statSync(logPath, { throwIfNoEntry: false })
    // Keep the previous file instead of truncating, so a rotation never drops the lines before a failure.
    if (stat && stat.size + Buffer.byteLength(entry) > maxLogBytes) fs.renameSync(logPath, `${logPath}.1`)
    fs.appendFileSync(logPath, entry, { encoding: "utf8", mode: 0o600 })
    fs.chmodSync(logPath, 0o600)
  } catch {
    // Process-fault logging must never hide or replace the original fault.
  }
}

/**
 * The relay's operational log: one line per lifecycle event (start, extension connects and disconnects, HTTP
 * requests with status and duration, faults), always on, in <data root>/logs/relay.log. Per-CDP-message
 * tracing stays behind OPENCODE_BROWSER_DEBUG.
 */
export function relayLog(event: string, fields: Record<string, unknown> = {}): void {
  const detail = Object.entries(fields)
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => `${key}=${typeof value === "string" && !/\s/.test(value) ? value : JSON.stringify(value)}`)
    .join(" ")
  appendManagedRelayProcessLog(detail ? `${event} ${detail}` : event)
}
