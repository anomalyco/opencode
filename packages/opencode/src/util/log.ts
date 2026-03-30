import path from "path"
import fs from "fs/promises"
import { createWriteStream } from "fs"
import { Global } from "../global"
import z from "zod"
import { Glob } from "./glob"

export namespace Log {
  export const Level = z.enum(["DEBUG", "INFO", "WARN", "ERROR"]).meta({ ref: "LogLevel", description: "Log level" })
  export type Level = z.infer<typeof Level>
  export const Entry = z
    .object({
      id: z.string(),
      time: z.number(),
      level: Level,
      service: z.string(),
      message: z.string(),
      extra: z.record(z.string(), z.any()).optional(),
    })
    .meta({ ref: "LogEntry", description: "Structured server log entry" })
  export type Entry = z.infer<typeof Entry>
  export interface Filter {
    limit?: number
    service?: string
    level?: Level
    sessionID?: string
  }

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

  export type Logger = {
    debug(message?: any, extra?: Record<string, any>): void
    info(message?: any, extra?: Record<string, any>): void
    error(message?: any, extra?: Record<string, any>): void
    warn(message?: any, extra?: Record<string, any>): void
    tag(key: string, value: string): Logger
    clone(): Logger
    time(
      message: string,
      extra?: Record<string, any>,
    ): {
      stop(): void
      [Symbol.dispose](): void
    }
  }

  const loggers = new Map<string, Logger>()
  const subscribers = new Set<(entry: Entry) => void>()
  const recent: Entry[] = []
  const RECENT_LIMIT = 400

  export const Default = create({ service: "default" })

  export interface Options {
    print: boolean
    dev?: boolean
    level?: Level
  }

  let logpath = ""
  let sequence = 0
  export function file() {
    return logpath
  }
  let write = (msg: any) => {
    process.stderr.write(msg)
    return msg.length
  }

  function nextID(time: number) {
    sequence += 1
    return `${time}-${sequence}`
  }

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

  function stringify(value: unknown) {
    if (value instanceof Error) return formatError(value)
    if (typeof value === "string") return value
    if (value === undefined) return ""
    if (typeof value === "object") {
      try {
        return JSON.stringify(value)
      } catch {
        return String(value)
      }
    }
    return String(value)
  }

  function normalizeExtra(value: Record<string, any>) {
    const entries = Object.entries(value).filter(([_, item]) => item !== undefined && item !== null)
    if (!entries.length) return
    return Object.fromEntries(entries)
  }

  function publish(entry: Entry) {
    recent.push(entry)
    if (recent.length > RECENT_LIMIT) {
      recent.splice(0, recent.length - RECENT_LIMIT)
    }

    for (const subscriber of subscribers) {
      try {
        subscriber(entry)
      } catch {}
    }
  }

  function formatPrefix(extra?: Record<string, any>) {
    return Object.entries(extra ?? {})
      .map(([key, value]) => `${key}=${stringify(value)}`)
      .join(" ")
  }

  function formatLine(entry: Entry, diff: number) {
    const prefix = formatPrefix({
      service: entry.service,
      ...entry.extra,
    })
    return [
      new Date(entry.time).toISOString().split(".")[0],
      "+" + diff + "ms",
      prefix,
      entry.message,
    ]
      .filter(Boolean)
      .join(" ") + "\n"
  }

  let last = Date.now()
  export function create(tags?: Record<string, any>) {
    tags = tags || {}

    const service = tags["service"]
    if (service && typeof service === "string") {
      const cached = loggers.get(service)
      if (cached) {
        return cached
      }
    }

    function buildEntry(level: Level, message: any, extra?: Record<string, any>) {
      const next = new Date()
      const diff = next.getTime() - last
      last = next.getTime()
      const combined = normalizeExtra({
        ...tags,
        ...extra,
      })
      const resolvedService =
        typeof combined?.service === "string" ? combined.service : typeof tags?.service === "string" ? tags.service : "default"
      const metadata = combined
        ? Object.fromEntries(Object.entries(combined).filter(([key]) => key !== "service"))
        : undefined
      return {
        entry: {
          id: nextID(next.getTime()),
          time: next.getTime(),
          level,
          service: resolvedService,
          message: stringify(message),
          ...(metadata && Object.keys(metadata).length ? { extra: metadata } : {}),
        } satisfies Entry,
        diff,
      }
    }

    function record(level: Level, message: any, extra?: Record<string, any>) {
      const built = buildEntry(level, message, extra)
      publish(built.entry)
      write(level.padEnd(5, " ") + " " + formatLine(built.entry, built.diff))
    }
    const result: Logger = {
      debug(message?: any, extra?: Record<string, any>) {
        if (shouldLog("DEBUG")) {
          record("DEBUG", message, extra)
        }
      },
      info(message?: any, extra?: Record<string, any>) {
        if (shouldLog("INFO")) {
          record("INFO", message, extra)
        }
      },
      error(message?: any, extra?: Record<string, any>) {
        if (shouldLog("ERROR")) {
          record("ERROR", message, extra)
        }
      },
      warn(message?: any, extra?: Record<string, any>) {
        if (shouldLog("WARN")) {
          record("WARN", message, extra)
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

  export function matches(entry: Entry, input?: Omit<Filter, "limit">) {
    if (input?.service && entry.service !== input.service) return false
    if (input?.level && entry.level !== input.level) return false
    if (input?.sessionID) {
      const value = entry.extra?.sessionID
      if (typeof value !== "string" || value !== input.sessionID) return false
    }
    return true
  }

  export function list(input?: Filter) {
    const limit = Math.max(1, Math.min(500, Math.trunc(input?.limit ?? 200)))
    const filtered = recent.filter((entry) => matches(entry, input))
    return filtered.slice(Math.max(0, filtered.length - limit))
  }

  export function subscribe(fn: (entry: Entry) => void) {
    subscribers.add(fn)
    return () => {
      subscribers.delete(fn)
    }
  }
}
