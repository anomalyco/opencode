import { Context, Formatter, Layer, Logger, References } from "effect"

export type LogLevel = "trace" | "debug" | "info" | "warn" | "error" | "fatal"

export type LogEntry = {
  readonly level: LogLevel
  readonly message: string
  readonly attributes?: Readonly<Record<string, unknown>>
  readonly cause?: unknown
}

export type LogWriter = (entry: LogEntry) => void

export type LogOptions = {
  readonly level?: LogLevel
  readonly emit: LogWriter
}

const levels: Record<LogLevel, Logger.Options<unknown>["logLevel"]> = {
  trace: "Trace",
  debug: "Debug",
  info: "Info",
  warn: "Warn",
  error: "Error",
  fatal: "Fatal",
}
const levelNames = new Map<Logger.Options<unknown>["logLevel"], LogLevel>([
  [levels.trace, "trace"],
  [levels.debug, "debug"],
  [levels.info, "info"],
  [levels.warn, "warn"],
  [levels.error, "error"],
  [levels.fatal, "fatal"],
])

function normalizeLevel(level: Logger.Options<unknown>["logLevel"]): LogLevel | undefined {
  return levelNames.get(level)
}

export function layer(log?: LogOptions) {
  const logger = Logger.make((options) => {
    if (!log) return
    const level = normalizeLevel(options.logLevel)
    if (!level) return
    const entry = Logger.formatStructured.log(options)
    const values = Array.isArray(entry.message) ? entry.message : [entry.message]
    const [message, ...data] = values
    const details =
      data.length === 1 && !Array.isArray(data[0]) ? (data[0] as Readonly<Record<string, unknown>>) : undefined
    const { cause: detailCause, ...detailAttributes } = details ?? {}
    const attributes = {
      ...entry.annotations,
      ...detailAttributes,
      ...(Object.keys(entry.spans).length > 0 ? { spans: entry.spans } : {}),
      ...(!details && data.length > 0 ? { data: data.length === 1 ? data[0] : data } : {}),
    }
    try {
      log.emit({
        level,
        message: typeof message === "string" ? message : Formatter.format(message),
        ...(Object.keys(attributes).length > 0 ? { attributes } : {}),
        ...(entry.cause === undefined && detailCause === undefined ? {} : { cause: entry.cause ?? detailCause }),
      })
    } catch {
      // A host logger must not break OpenCode operations.
    }
  })
  return Layer.merge(
    Logger.layer([logger], { mergeWithExisting: false }),
    Layer.succeed(References.MinimumLogLevel, levels[log?.level ?? "info"]),
  )
}

export function context(source: Context.Context<never>) {
  return Context.make(Logger.CurrentLoggers, Context.get(source, Logger.CurrentLoggers)).pipe(
    Context.add(References.MinimumLogLevel, Context.get(source, References.MinimumLogLevel)),
  )
}
