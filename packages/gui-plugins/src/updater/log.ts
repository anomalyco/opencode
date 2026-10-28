import { Effect, Layer, Logger, References } from "effect"

/** Services for running the updater's effects: every log goes to the desktop log file, debug included. */
export function logContext(
  log: (level: "debug" | "info" | "warn" | "error", message: string, data?: Record<string, unknown>) => void,
) {
  const logger = Logger.make((options) => {
    const entry = Logger.formatStructured.log(options)
    const [message, ...details] = Array.isArray(options.message) ? options.message : [options.message]
    const detail = details.length === 1 && isRecord(details[0]) ? details[0] : details.length ? { details } : {}
    log(LEVELS[options.logLevel] ?? "info", typeof message === "string" ? message : String(message), {
      ...detail,
      ...(Object.keys(entry.annotations).length === 0 ? {} : { annotations: entry.annotations }),
      ...(entry.cause === undefined ? {} : { cause: entry.cause }),
    })
  })

  return Effect.runSync(
    Effect.context<never>().pipe(
      Effect.provide(
        Layer.merge(
          Logger.layer([logger], { mergeWithExisting: false }),
          Layer.succeed(References.MinimumLogLevel, "All"),
        ),
      ),
    ),
  )
}

const LEVELS: Partial<Record<string, "debug" | "info" | "warn" | "error">> = {
  Trace: "debug",
  Debug: "debug",
  Info: "info",
  Warn: "warn",
  Error: "error",
  Fatal: "error",
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
