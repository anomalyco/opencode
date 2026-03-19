import path from "path"
import fs from "fs/promises"
import { createWriteStream } from "fs"
import { Global } from "../global"
import z from "zod"
import { Glob } from "./glob"

/**
 * Logging utility with structured logging support.
 *
 * Features:
 * - Multiple log levels (DEBUG, INFO, WARN, ERROR)
 * - Tagged loggers for contextual logging
 * - File output with automatic rotation
 * - Timing utilities for performance tracking
 *
 * @example
 * ```typescript
 * const log = Log.create({ service: "my-service" })
 * log.info("Processing started", { userId: 123 })
 * log.error("Failed to connect", { error: err.message })
 * ```
 */
export namespace Log {
  /** Log level enumeration - higher levels are more severe */
  export const Level = z.enum(["DEBUG", "INFO", "WARN", "ERROR"]).meta({ ref: "LogLevel", description: "Log level" })
  export type Level = z.infer<typeof Level>

  const levelPriority: Record<Level, number> = {
    DEBUG: 0,
    INFO: 1,
    WARN: 2,
    ERROR: 3,
  }

  let level: Level = "INFO"

  function shouldLog(input: Level): boolean {
    return levelPriority[input] >= levelPriority[level]
  }

  /**
   * Logger interface with tagging and timing capabilities.
   *
   * All logging methods accept:
   * - message: The primary log message
   * - extra: Optional structured data to include
   */
  export type Logger = {
    /** Log a debug message (lowest priority) */
    debug(message?: any, extra?: Record<string, any>): void
    /** Log an info message */
    info(message?: any, extra?: Record<string, any>): void
    /** Log an error message (highest priority) */
    error(message?: any, extra?: Record<string, any>): void
    /** Log a warning message */
    warn(message?: any, extra?: Record<string, any>): void
    /** Create a new logger with additional tag */
    tag(key: string, value: string): Logger
    /** Create a copy of this logger */
    clone(): Logger
    /**
     * Start a timer for performance tracking.
     * Returns an object with stop() method and dispose symbol for auto-stopping.
     */
    time(
      message: string,
      extra?: Record<string, any>,
    ): {
      stop(): void
      [Symbol.dispose](): void
    }
  }

  const loggers = new Map<string, Logger>()

  /** Default logger instance for general logging */
  export const Default = create({ service: "default" })

  /** Options for initializing the logging system */
  export interface Options {
    /** Whether to print to console instead of file */
    print: boolean
    /** Development mode - uses "dev.log" filename */
    dev?: boolean
    /** Minimum log level to record */
    level?: Level
  }

  let logpath = ""
  /** Get the current log file path */
  export function file() {
    return logpath
  }
  let write = (msg: any) => {
    process.stderr.write(msg)
    return msg.length
  }

  /**
   * Initialize the logging system.
   *
   * @param options - Configuration options for logging
   * @throws If log file cannot be created
   */
  export async function init(options: Options) {
    if (options.level) level = options.level
    cleanup(Global.Path.log)
    if (options.print) return
    logpath = path.join(
      Global.Path.log,
      options.dev ? "dev.log" : new Date().toISOString().split(".")[0].replace(/:/g, "") + ".log",
    )
    await fs.truncate(logpath).catch(() => {})
    const stream = createWriteStream(logpath, { flags: "a" })
    write = async (msg: any) => {
      return new Promise((resolve, reject) => {
        stream.write(msg, (err) => {
          if (err) reject(err)
          else resolve(msg.length)
        })
      })
    }
  }

  async function cleanup(dir: string) {
    const files = await Glob.scan("????-??-??T??????.log", {
      cwd: dir,
      absolute: true,
      include: "file",
    })
    if (files.length <= 5) return

    const filesToDelete = files.slice(0, -10)
    await Promise.all(filesToDelete.map((file) => fs.unlink(file).catch(() => {})))
  }

  function formatError(error: Error, depth = 0): string {
    const result = error.message
    return error.cause instanceof Error && depth < 10
      ? result + " Caused by: " + formatError(error.cause, depth + 1)
      : result
  }

  let last = Date.now()

  /**
   * Create a new logger with the given tags.
   *
   * Loggers are cached by service name for reuse.
   *
   * @param tags - Key-value pairs to include in all log entries from this logger
   * @returns A configured Logger instance
   * @example
   * ```typescript
   * const log = Log.create({ service: "database", host: "localhost" })
   * log.info("Connected") // Logs: service=database host=localhost Connected
   * ```
   */
  export function create(tags?: Record<string, any>) {
    tags = tags || {}

    const service = tags["service"]
    if (service && typeof service === "string") {
      const cached = loggers.get(service)
      if (cached) {
        return cached
      }
    }

    function build(message: any, extra?: Record<string, any>) {
      const prefix = Object.entries({
        ...tags,
        ...extra,
      })
        .filter(([_, value]) => value !== undefined && value !== null)
        .map(([key, value]) => {
          const prefix = `${key}=`
          if (value instanceof Error) return prefix + formatError(value)
          if (typeof value === "object") return prefix + JSON.stringify(value)
          return prefix + value
        })
        .join(" ")
      const next = new Date()
      const diff = next.getTime() - last
      last = next.getTime()
      return [next.toISOString().split(".")[0], "+" + diff + "ms", prefix, message].filter(Boolean).join(" ") + "\n"
    }
    const result: Logger = {
      debug(message?: any, extra?: Record<string, any>) {
        if (shouldLog("DEBUG")) {
          write("DEBUG " + build(message, extra))
        }
      },
      info(message?: any, extra?: Record<string, any>) {
        if (shouldLog("INFO")) {
          write("INFO  " + build(message, extra))
        }
      },
      error(message?: any, extra?: Record<string, any>) {
        if (shouldLog("ERROR")) {
          write("ERROR " + build(message, extra))
        }
      },
      warn(message?: any, extra?: Record<string, any>) {
        if (shouldLog("WARN")) {
          write("WARN  " + build(message, extra))
        }
      },
      tag(key: string, value: string) {
        if (tags) tags[key] = value
        return result
      },
      clone() {
        return Log.create({ ...tags })
      },
      time(message: string, extra?: Record<string, any>) {
        const now = Date.now()
        result.info(message, { status: "started", ...extra })
        function stop() {
          result.info(message, {
            status: "completed",
            duration: Date.now() - now,
            ...extra,
          })
        }
        return {
          stop,
          [Symbol.dispose]() {
            stop()
          },
        }
      },
    }

    if (service && typeof service === "string") {
      loggers.set(service, result)
    }

    return result
  }
}
