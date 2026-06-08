import { Logger, type LogLevel } from "effect"
import path from "path"
import { Global } from "../global"
import { runID } from "./shared"

function formatter(id: string = runID) {
  return Logger.map(Logger.formatLogFmt, (output) =>
    output.replace(/ level=([^ ]+)/, (_, level: string) => ` level=${level.toUpperCase()} run_id=${id}`),
  )
}

export function fileLogger(file = path.join(Global.Path.log, "opencode.log"), id: string = runID) {
  return Logger.toFile(formatter(id), file, { flag: "a", batchWindow: 0 })
}

const stderrLogger = Logger.make((options) => process.stderr.write(formatter().log(options) + "\n"))

export function minimumLogLevel() {
  const value = process.env.OPENCODE_LOG_LEVEL?.toUpperCase()
  const levels = {
    DEBUG: "Debug",
    INFO: "Info",
    WARN: "Warn",
    ERROR: "Error",
  } as const satisfies Record<string, LogLevel.LogLevel>
  return value && value in levels ? levels[value as keyof typeof levels] : levels.INFO
}

export function loggers() {
  return process.env.OPENCODE_PRINT_LOGS === "1" ? [fileLogger(), stderrLogger] : [fileLogger()]
}

export * as Logging from "./logging"
