// fork: minimal synchronous logger for the handful of call sites that log
// from outside any Effect context (a .catch() callback, a plain try/catch —
// not inside Effect.gen). Deliberately not `Effect.runSync(Effect.logX(...))`:
// verified empirically that a bare Effect.runSync with no app runtime
// provided falls back to Effect's default console logger, writing straight
// to stdout — which is exactly the TUI-corruption bug fixed by
// `fix(log): route fork logger shim to file, not stdout/stderr` (bd7527eff3,
// for the now-deleted `core/util/log.ts` legacy shim this replaces). Threading
// the real app runtime (`effect/app-runtime.ts`'s AppRuntime) into these call
// sites was the more "correct" fix but risks a circular import — provider.ts
// and local/placement.ts sit low enough in the dependency graph that pulling
// in AppRuntime's full layer (which composes most of the app, including
// Provider itself) was not worth the risk for two files' worth of log calls.
//
// Call sites already inside Effect.gen use `yield* Effect.logInfo/Warning/
// Error/Debug(...)` directly instead — they inherit the app's real
// Observability layer for free, no helper needed.
import fs from "fs"
import path from "path"
import { Global } from "@opencode-ai/core/global"

const LOG_FILE = path.join(Global.Path.log, "opencode.log")
let logDirReady = false

function ensureLogDir() {
  if (logDirReady) return
  fs.mkdirSync(Global.Path.log, { recursive: true })
  logDirReady = true
}

function write(level: "INFO" | "WARN" | "ERROR", service: string, message: string, extra?: Record<string, unknown>) {
  const fields = extra
    ? Object.entries(extra)
        .filter(([, v]) => v !== undefined)
        .map(([k, v]) => `${k}=${typeof v === "string" ? v : JSON.stringify(v)}`)
        .join(" ")
    : ""
  const line = [new Date().toISOString(), level.padEnd(5), `service=${service}`, message, fields]
    .filter(Boolean)
    .join(" ")
  try {
    ensureLogDir()
    fs.appendFileSync(LOG_FILE, line + "\n")
  } catch {
    // Logging must never throw into the caller's own error path.
  }
  if (process.env["OPENCODE_PRINT_LOGS"] === "1") process.stderr.write(line + "\n")
}

export function syncLogInfo(service: string, message: string, extra?: Record<string, unknown>) {
  write("INFO", service, message, extra)
}

export function syncLogWarn(service: string, message: string, extra?: Record<string, unknown>) {
  write("WARN", service, message, extra)
}

export function syncLogError(service: string, message: string, extra?: Record<string, unknown>) {
  write("ERROR", service, message, extra)
}
