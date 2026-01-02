import { Log } from "../util/log"
import { BusEvent } from "@/bus/bus-event"
import { Bus } from "@/bus"
import { Instance } from "../project/instance"
import { Identifier } from "../id/id"
import z from "zod"
import path from "path"
import fs from "fs/promises"

export namespace DebugServer {
  const log = Log.create({ service: "debug-server" })

  export const LogEntry = z.object({
    id: z.string(),
    sessionID: z.string(),
    timestamp: z.number(),
    level: z.enum(["debug", "info", "warn", "error"]).optional(),
    message: z.string(),
    // New compact format
    location: z.string().optional(), // "file.tsx:42"
    hypothesisId: z.string().optional(), // "A", "B", etc.
    // Legacy format
    file: z.string().optional(),
    line: z.number().optional(),
    column: z.number().optional(),
    functionName: z.string().optional(),
    data: z.record(z.string(), z.any()).optional(),
  })
  export type LogEntry = z.infer<typeof LogEntry>

  export const Event = {
    LogReceived: BusEvent.define("debug.log.received", LogEntry),
    SessionStarted: BusEvent.define(
      "debug.session.started",
      z.object({
        sessionID: z.string(),
        timestamp: z.number(),
      }),
    ),
    SessionEnded: BusEvent.define(
      "debug.session.ended",
      z.object({
        sessionID: z.string(),
        timestamp: z.number(),
        logFile: z.string().optional(),
      }),
    ),
  }

  const state = Instance.state(() => {
    const sessions: Map<
      string,
      {
        logs: LogEntry[]
        startTime: number
        isActive: boolean
      }
    > = new Map()

    return { sessions }
  })

  export function startSession(sessionID: string): void {
    const { sessions } = state()
    if (sessions.has(sessionID)) {
      log.warn("Debug session already exists, clearing logs", { sessionID })
    }
    sessions.set(sessionID, {
      logs: [],
      startTime: Date.now(),
      isActive: true,
    })
    log.info("Debug session started", { sessionID })
    Bus.publish(Event.SessionStarted, {
      sessionID,
      timestamp: Date.now(),
    })
  }

  export function endSession(sessionID: string): LogEntry[] {
    const { sessions } = state()
    const session = sessions.get(sessionID)
    if (!session) {
      log.warn("No debug session found to end", { sessionID })
      return []
    }
    session.isActive = false
    log.info("Debug session ended", { sessionID, logCount: session.logs.length })
    return session.logs
  }

  export function addLog(entry: Omit<LogEntry, "id">): void {
    const { sessions } = state()
    const session = sessions.get(entry.sessionID)
    if (!session) {
      log.warn("No active debug session for log", { sessionID: entry.sessionID })
      return
    }
    if (!session.isActive) {
      log.warn("Debug session is not active", { sessionID: entry.sessionID })
      return
    }
    const fullEntry: LogEntry = {
      ...entry,
      id: Identifier.ascending("debug-log"),
    }
    session.logs.push(fullEntry)
    Bus.publish(Event.LogReceived, fullEntry)
  }

  export function getLogs(sessionID: string): LogEntry[] {
    const { sessions } = state()
    return sessions.get(sessionID)?.logs ?? []
  }

  // Aggregate logs into a compact summary for AI consumption
  export function getLogsSummary(sessionID: string): string {
    const logs = getLogs(sessionID)
    if (logs.length === 0) return "No logs received yet."

    // Group by location (file:line) or message
    const groups = new Map<string, {
      count: number
      firstTime: number
      lastTime: number
      hypotheses: Set<string>
      sampleData: Record<string, unknown>[]
      messages: string[]
    }>()

    for (const entry of logs) {
      const key = entry.location ?? entry.message.split(" ")[0] ?? "unknown"

      if (!groups.has(key)) {
        groups.set(key, {
          count: 0,
          firstTime: entry.timestamp,
          lastTime: entry.timestamp,
          hypotheses: new Set(),
          sampleData: [],
          messages: []
        })
      }

      const group = groups.get(key)!
      group.count++
      group.lastTime = Math.max(group.lastTime, entry.timestamp)
      if (entry.hypothesisId) group.hypotheses.add(entry.hypothesisId)
      if (entry.data && group.sampleData.length < 3) {
        group.sampleData.push(entry.data)
      }
      if (!group.messages.includes(entry.message)) {
        group.messages.push(entry.message)
      }
    }

    // Build summary
    const lines: string[] = []
    const startTime = logs[0]?.timestamp ?? Date.now()
    const endTime = logs[logs.length - 1]?.timestamp ?? Date.now()
    const duration = ((endTime - startTime) / 1000).toFixed(1)

    lines.push(`=== Debug Summary (${logs.length} logs over ${duration}s) ===`)
    lines.push("")

    // Sort by count descending
    const sorted = [...groups.entries()].sort((a, b) => b[1].count - a[1].count)

    for (const [location, data] of sorted) {
      const hyp = data.hypotheses.size > 0 ? `[${[...data.hypotheses].join(",")}]` : ""
      const msgs = data.messages.length > 1 ? ` (${data.messages.length} unique msgs)` : ""
      lines.push(`${location}: ${data.count}x ${hyp}${msgs}`)

      // Show unique messages if there are few
      if (data.messages.length <= 3 && data.messages.length > 1) {
        for (const msg of data.messages) {
          lines.push(`  - "${msg}"`)
        }
      }

      // Show sample data if interesting
      if (data.sampleData.length > 0) {
        const sample = data.sampleData[0]
        const keys = Object.keys(sample)
        if (keys.length > 0) {
          // Summarize numeric ranges
          const numericKeys = keys.filter(k => typeof sample[k] === "number")
          if (numericKeys.length > 0 && data.sampleData.length > 1) {
            for (const key of numericKeys.slice(0, 3)) {
              const values = data.sampleData.map(d => d[key] as number).filter(v => v !== undefined)
              const min = Math.min(...values)
              const max = Math.max(...values)
              if (min !== max) {
                lines.push(`  ${key}: ${min} → ${max}`)
              }
            }
          } else {
            // Just show first sample
            const preview = JSON.stringify(sample).slice(0, 80)
            lines.push(`  data: ${preview}${preview.length >= 80 ? "..." : ""}`)
          }
        }
      }
    }

    return lines.join("\n")
  }

  export function isActive(sessionID: string): boolean {
    const { sessions } = state()
    return sessions.get(sessionID)?.isActive ?? false
  }

  export function clearSession(sessionID: string): void {
    const { sessions } = state()
    sessions.delete(sessionID)
    log.info("Debug session cleared", { sessionID })
  }

  export async function exportToFile(sessionID: string): Promise<string> {
    const logs = getLogs(sessionID)
    const debugDir = path.join(Instance.directory, ".opencode", "debug")
    await fs.mkdir(debugDir, { recursive: true })

    const timestamp = new Date().toISOString().replace(/[:.]/g, "-")
    const filename = `debug-${sessionID.slice(0, 8)}-${timestamp}.log`
    const filepath = path.join(debugDir, filename)

    const content = logs
      .map((entry) => {
        const loc = entry.location ?? (entry.file ? `${entry.file}:${entry.line ?? "?"}` : "")
        const hyp = entry.hypothesisId ? `[${entry.hypothesisId}]` : ""
        const lvl = (entry.level ?? "info").toUpperCase()
        const data = entry.data ? ` ${JSON.stringify(entry.data)}` : ""
        const time = new Date(entry.timestamp).toISOString()
        return `[${time}] [${lvl}] ${hyp} ${loc} ${entry.message}${data}`
      })
      .join("\n")

    await fs.writeFile(filepath, content, "utf-8")
    log.info("Debug logs exported", { filepath, logCount: logs.length })

    Bus.publish(Event.SessionEnded, {
      sessionID,
      timestamp: Date.now(),
      logFile: filepath,
    })

    return filepath
  }

  // Generate client-side logging snippet for different languages
  export function getClientSnippet(
    language: "javascript" | "typescript" | "python",
    sessionID: string,
    options?: { network?: boolean; console?: boolean; errors?: boolean; perf?: boolean; react?: boolean }
  ): string {
    const serverUrl = `http://localhost:4096/debug/log`

    if (language === "javascript" || language === "typescript") {
      const isTS = language === "typescript"

      // Base log function
      const base = isTS
        ? `const __oc_log = (loc: string, msg: string, data?: Record<string, unknown>, hyp?: string) => { fetch("${serverUrl}",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({sessionID:"${sessionID}",location:loc,message:msg,data,hypothesisId:hyp,level:"info",timestamp:Date.now()})}).catch(()=>{}); };`
        : `const __oc_log = (loc, msg, data, hyp) => { fetch("${serverUrl}",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({sessionID:"${sessionID}",location:loc,message:msg,data,hypothesisId:hyp,level:"info",timestamp:Date.now()})}).catch(()=>{}); };`

      // Network interception (skip debug server calls to avoid infinite loop)
      const network = options?.network
        ? isTS
          ? `\nconst __oc_fetch = window.fetch; window.fetch = (async (url: RequestInfo | URL, opts?: RequestInit) => { const u = String(url); if (u.includes("localhost:4096")) return __oc_fetch(url, opts); const start = Date.now(); try { const res = await __oc_fetch(url, opts); __oc_log("[NET]", (opts?.method||"GET")+" "+u, {status:res.status,ms:Date.now()-start}); return res; } catch(e: unknown) { __oc_log("[NET]", (opts?.method||"GET")+" "+u, {error:(e as Error).message,ms:Date.now()-start}); throw e; }}) as typeof fetch;`
          : `\nconst __oc_fetch = window.fetch; window.fetch = async (url, opts) => { const u = String(url); if (u.includes("localhost:4096")) return __oc_fetch(url, opts); const start = Date.now(); try { const res = await __oc_fetch(url, opts); __oc_log("[NET]", (opts?.method||"GET")+" "+u, {status:res.status,ms:Date.now()-start}); return res; } catch(e) { __oc_log("[NET]", (opts?.method||"GET")+" "+u, {error:e.message,ms:Date.now()-start}); throw e; }};`
        : ""

      // Console interception
      const consoleIntercept = options?.console
        ? `\nconst __oc_console = { log: console.log, warn: console.warn, error: console.error }; console.log = (...args${isTS ? ": unknown[]" : ""}) => { __oc_log("[CONSOLE]", "log", {args: args.map(a => typeof a === "object" ? JSON.stringify(a).slice(0,200) : String(a).slice(0,200))}); __oc_console.log(...args); }; console.warn = (...args${isTS ? ": unknown[]" : ""}) => { __oc_log("[CONSOLE]", "warn", {args: args.map(a => typeof a === "object" ? JSON.stringify(a).slice(0,200) : String(a).slice(0,200))}); __oc_console.warn(...args); }; console.error = (...args${isTS ? ": unknown[]" : ""}) => { __oc_log("[CONSOLE]", "error", {args: args.map(a => typeof a === "object" ? JSON.stringify(a).slice(0,200) : String(a).slice(0,200))}); __oc_console.error(...args); };`
        : ""

      // Error capture
      const errorCapture = options?.errors
        ? `\nwindow.onerror = (msg, src, line, col, err) => { __oc_log("[ERROR]", String(msg), {src, line, col, stack: err?.stack?.slice(0,500)}); }; window.onunhandledrejection = (e${isTS ? ": PromiseRejectionEvent" : ""}) => { __oc_log("[UNHANDLED]", String(e.reason), {stack: e.reason?.stack?.slice(0,500)}); };`
        : ""

      // Performance timing helper
      const perfHelper = options?.perf
        ? isTS
          ? `\nconst __oc_perf = new Map<string, number>(); const __oc_start = (label: string) => { __oc_perf.set(label, performance.now()); }; const __oc_end = (label: string, data?: Record<string, unknown>) => { const start = __oc_perf.get(label); if (start) { __oc_log("[PERF]", label, { ms: Math.round(performance.now() - start), ...data }); __oc_perf.delete(label); }};`
          : `\nconst __oc_perf = new Map(); const __oc_start = (label) => { __oc_perf.set(label, performance.now()); }; const __oc_end = (label, data) => { const start = __oc_perf.get(label); if (start) { __oc_log("[PERF]", label, { ms: Math.round(performance.now() - start), ...data }); __oc_perf.delete(label); }};`
        : ""

      // React render tracker (useDebugValue alternative)
      const reactHelper = options?.react
        ? isTS
          ? `\nlet __oc_renders: Record<string, number> = {}; const __oc_render = (component: string, props?: Record<string, unknown>) => { __oc_renders[component] = (__oc_renders[component] || 0) + 1; __oc_log("[RENDER]", component, { count: __oc_renders[component], props: props ? Object.keys(props) : [] }); }; const __oc_state = (component: string, name: string, value: unknown) => { __oc_log("[STATE]", component+"."+name, { value: typeof value === "object" ? JSON.stringify(value).slice(0,200) : value }); };`
          : `\nlet __oc_renders = {}; const __oc_render = (component, props) => { __oc_renders[component] = (__oc_renders[component] || 0) + 1; __oc_log("[RENDER]", component, { count: __oc_renders[component], props: props ? Object.keys(props) : [] }); }; const __oc_state = (component, name, value) => { __oc_log("[STATE]", component+"."+name, { value: typeof value === "object" ? JSON.stringify(value).slice(0,200) : value }); };`
        : ""

      return `
// #region opencode-debug-client
${base}${network}${consoleIntercept}${errorCapture}${perfHelper}${reactHelper}
// #endregion
`.trim()
    }

    if (language === "python") {
      return `
# OpenCode Debug Client - Add this at the top of your file
import requests
import time
import json
import traceback

class __OpenCodeDebug:
    def __init__(self):
        self.session_id = "${sessionID}"
        self.url = "${serverUrl}"

    def _log(self, level, message, data=None, file=None, line=None, function_name=None):
        try:
            requests.post(self.url, json={
                "sessionID": self.session_id,
                "timestamp": int(time.time() * 1000),
                "level": level,
                "message": message,
                "file": file,
                "line": line,
                "functionName": function_name,
                "data": data
            }, timeout=0.5)
        except:
            pass

    def debug(self, msg, data=None, **meta):
        self._log("debug", msg, data, **meta)

    def info(self, msg, data=None, **meta):
        self._log("info", msg, data, **meta)

    def warn(self, msg, data=None, **meta):
        self._log("warn", msg, data, **meta)

    def error(self, msg, data=None, **meta):
        self._log("error", msg, data, **meta)

__opencode_debug = __OpenCodeDebug()
# End OpenCode Debug Client
`.trim()
    }

    throw new Error(`Unsupported language: ${language}`)
  }
}
