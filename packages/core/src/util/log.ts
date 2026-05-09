export * as Log from "./log"

import path from "path"
import fs from "fs/promises"
import { createWriteStream } from "fs"
import * as Global from "../global"
import z from "zod"
import { Glob } from "./glob"

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

export const Default = create({ service: "default" })

export interface Options {
  print: boolean
  dev?: boolean
  level?: Level
}

let logpath = ""
export function file() {
  return logpath
}
export const MAX = 128 * 1024 * 1024
const step = 1024 * 1024
const wait = 5_000
let size = 0
let time = 0
let task: Promise<void> | undefined

type Entry = {
  file: string
  size: number
  time: number
}

async function entries(dir: string) {
  const list = await Glob.scan("*", {
    cwd: dir,
    absolute: true,
    include: "file",
  }).catch(() => [] as string[])
  const rows = await Promise.all(
    list
      .filter((file) => file.endsWith(".log") || file.endsWith(".ndjson"))
      .map(async (file) => {
        const stat = await fs.stat(file).catch(() => undefined)
        if (!stat) return
        return {
          file,
          size: stat.size,
          time: stat.mtimeMs,
        } satisfies Entry
      }),
  )
  return rows.filter((item): item is Entry => Boolean(item))
}

async function tail(file: string, keep: number) {
  const stat = await fs.stat(file).catch(() => undefined)
  if (!stat) return 0
  if (keep <= 0) {
    await fs.truncate(file, 0).catch(() => {})
    return 0
  }
  if (stat.size <= keep) return stat.size

  const fd = await fs.open(file, "r")
  try {
    const buf = Buffer.allocUnsafe(keep)
    await fd.read(buf, 0, keep, stat.size - keep)
    await fs.writeFile(file, buf)
    return keep
  } finally {
    await fd.close().catch(() => {})
  }
}

export async function trim(input?: {
  dir?: string
  max?: number
  file?: string
}) {
  const dir = input?.dir ?? Global.Path.log
  const keep = input?.max ?? MAX
  const file = input?.file ?? logpath
  const rows = (await entries(dir)).sort((a, b) => a.time - b.time)
  let total = rows.reduce((sum, row) => sum + row.size, 0)
  if (total <= keep) return

  for (const row of rows) {
    if (total <= keep) return
    if (row.file === file) continue
    await fs.unlink(row.file).catch(() => {})
    total -= row.size
  }

  if (total <= keep) return
  const row = rows.find((row) => row.file === file)
  if (!row) return

  const room = Math.max(0, keep - (total - row.size))
  total = total - row.size + (await tail(row.file, room))
  if (total <= keep) return
}

function sweep() {
  const now = Date.now()
  if (task) return
  if (size < step && now - time < wait) return
  size = 0
  time = now
  task = trim().finally(() => {
    task = undefined
  })
}

let write = (msg: any) => {
  process.stderr.write(msg)
  size += msg.length
  sweep()
  return msg.length
}

export async function init(options: Options) {
  if (options.level) level = options.level
  await trim()
  if (options.print) return
  logpath = path.join(
    Global.Path.log,
    options.dev ? "dev.log" : new Date().toISOString().split(".")[0].replace(/:/g, "") + ".log",
  )
  await fs.truncate(logpath).catch(() => {})
  const stream = createWriteStream(logpath, { flags: "a" })
  write = async (msg: any) => {
    return new Promise((resolve) => {
      stream.write(msg, (err) => {
        if (err) {
          resolve(0)
          return
        }
        size += msg.length
        sweep()
        resolve(msg.length)
      })
    })
  }
}

function formatError(error: Error, depth = 0): string {
  const result = error.message
  return error.cause instanceof Error && depth < 10
    ? result + " Caused by: " + formatError(error.cause, depth + 1)
    : result
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
      return create({ ...tags })
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
