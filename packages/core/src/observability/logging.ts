import { NodeFileSystem } from "@effect/platform-node"
import { Effect, Layer, Logger, References, type LogLevel } from "effect"
import path from "path"
import { Global } from "../global"

const runID = crypto.randomUUID()

function formatter(id: string = runID) {
  return Logger.map(Logger.formatLogFmt, (output) =>
    output.replace(/ level=([^ ]+)/, (_, level: string) => ` level=${level.toUpperCase()} run_id=${id}`),
  )
}

export function fileLogger(file = path.join(Global.Path.log, "opencode.log"), id: string = runID) {
  return Logger.toFile(formatter(id), file, { flag: "a", batchWindow: 0 })
}

const stderrLogger = Logger.make((options) => process.stderr.write(formatter().log(options) + "\n"))

function minimumLogLevel() {
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

export function levelLayer() {
  return Layer.succeed(References.MinimumLogLevel, minimumLogLevel())
}

export const layer = Layer.unwrap(
  Effect.sync(() =>
    Logger.layer(loggers(), { mergeWithExisting: false }).pipe(
      Layer.provide(NodeFileSystem.layer),
      Layer.orDie,
      Layer.merge(levelLayer()),
    ),
  ),
)

export const id = runID

export * as Logging from "./logging"
