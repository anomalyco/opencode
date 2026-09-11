import path from "node:path"
import { appendFile } from "node:fs/promises"
import { inspect } from "node:util"
import { Global } from "@opencode-ai/core/global"
import { Logging } from "@opencode-ai/core/observability/logging"

// The TUI renders on the alternate screen while the server worker shares the
// same terminal. Any library that calls console.* (Ajv compiling third-party
// MCP schemas, plugin dependencies, ...) would write raw lines straight into
// the TUI and corrupt it. In TUI mode the console methods are redirected into
// the opencode log file instead of the terminal, so no output can ever break
// the display. Non-TUI entrypoints (serve, mcp list, ...) never install this.
// https://github.com/anomalyco/opencode/issues/31002

const LEVELS = { Debug: 0, Info: 1, Warn: 2, Error: 3 } as const

function installConsole() {
  const format = (...args: unknown[]) => {
    try {
      return args.map((arg) => (typeof arg === "string" ? arg : inspect(arg, { depth: 3 }))).join(" ")
    } catch {
      return "<unformattable console output>"
    }
  }

  const write = (level: keyof typeof LEVELS, args: unknown[]) => {
    if (LEVELS[level] < LEVELS[Logging.minimumLogLevel()]) return
    const line = `timestamp=${new Date().toISOString()} level=${level.toLowerCase()} service=console message=${JSON.stringify(format(...args))}\n`
    void appendFile(path.join(Global.Path.log, "opencode.log"), line).catch(() => {})
  }

  console.debug = (...args: unknown[]) => write("Debug", args)
  console.info = (...args: unknown[]) => write("Info", args)
  console.log = (...args: unknown[]) => write("Info", args)
  console.warn = (...args: unknown[]) => write("Warn", args)
  console.error = (...args: unknown[]) => write("Error", args)
}

/** Redirect all console output to the log file. For TUI mode only. */
export function installConsoleGuard() {
  installConsole()
}

export * as ConsoleGuard from "./console-guard"
