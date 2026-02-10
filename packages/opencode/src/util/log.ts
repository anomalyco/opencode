import path from "path"
import fs from "fs/promises"
import { Global } from "../global"
import z from "zod"

export namespace Log {
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

  export type Rotate =
    | {
        kind: "startup"
        retention?: number
      }
    | {
        kind: "daily"
        retention?: number
      }

  export interface Options {
    print: boolean
    dev?: boolean
    level?: Level
    path?: string
    rotate?: Rotate
  }

  let logpath = ""
  export function file() {
    return logpath
  }
  let write = (msg: any) => {
    process.stderr.write(msg)
    return msg.length
  }

  let current = ""
  let writer: ReturnType<ReturnType<typeof Bun.file>["writer"]> | undefined

  function today() {
    const d = new Date()
    return (
      d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0")
    )
  }

  function createWriter(filepath: string, truncate?: boolean) {
    if (writer) writer.end()
    logpath = filepath
    if (truncate) fs.truncate(filepath).catch(() => {})
    writer = Bun.file(filepath).writer()
  }

  function flushWriter(msg: any) {
    const num = writer!.write(msg)
    writer!.flush()
    return num
  }

  function rotate(dir: string) {
    const date = today()
    if (date === current && writer) return
    current = date
    createWriter(path.join(dir, `opencode-${date}.log`))
  }

  const writeStrategies: Record<Rotate["kind"], (options: Options) => Promise<void>> = {
    async startup(options) {
      const dir = options.path ?? Global.Path.log
      const retention = options.rotate?.retention ?? 10
      cleanup(dir, "????-??-??T??????.log", retention)
      const name = options.dev ? "dev.log" : new Date().toISOString().split(".")[0].replace(/:/g, "") + ".log"
      createWriter(path.join(dir, name), true)
      write = flushWriter
    },
    async daily(options) {
      const dir = options.path ?? Global.Path.log
      const retention = options.rotate?.retention ?? 7
      await fs.mkdir(dir, { recursive: true })
      rotate(dir)
      cleanup(dir, "opencode-????-??-??.log", retention)
      write = (msg: any) => {
        rotate(dir)
        return flushWriter(msg)
      }
    },
  }

  export async function init(options: Options) {
    if (options.level) level = options.level
    if (options.print) return
    return writeStrategies[options.rotate?.kind ?? "startup"](options)
  }

  async function cleanup(dir: string, pattern: string, retention: number) {
    const glob = new Bun.Glob(pattern)
    const files = await Array.fromAsync(
      glob.scan({
        cwd: dir,
        absolute: true,
      }),
    )
    if (files.length <= retention) return
    files.sort()
    const filesToDelete = files.slice(0, -retention)
    await Promise.all(filesToDelete.map((file) => fs.unlink(file).catch(() => {})))
  }

  function formatError(error: Error): string[] {
    return Object.getOwnPropertyNames(error).flatMap((k) => {
      const v = (error as any)[k]
      if (v == null) return []
      if (v instanceof Error) return [`${k}=${v.name}: ${v.message}`, ...formatError(v).map((s) => `${k}.${s}`)]
      if (typeof v === "object") return [`${k}=${JSON.stringify(v)}`]
      return [`${k}=${v}`]
    })
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
        .flatMap(([key, value]) => {
          if (value == null) return []
          if (value instanceof Error) return formatError(value)
          if (typeof value === "object") return [`${key}=${JSON.stringify(value)}`]
          return [`${key}=${value}`]
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
