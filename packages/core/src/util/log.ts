// fork: compatibility shim for the legacy logger.
//
// Upstream removed this module in #31310 ("refactor(core): replace legacy
// logger with Effect logging"). Several fork-only modules still use the old
// `Log.create({ service }).info/warn/error/debug` API — beads, local-provider
// sync, and the provider openai-compatible discovery path. Rather than rewrite
// each to Effect logging mid-sync, we keep a minimal console-backed
// implementation at the original import path. Upstream has abandoned this path,
// so it will never conflict on future syncs.
//
// To retire this shim later, migrate those callers to upstream's Effect logging
// and delete this file (and its manifest entry).

const LEVELS = { DEBUG: 10, INFO: 20, WARN: 30, ERROR: 40 } as const
type LevelName = keyof typeof LEVELS

function threshold(): number {
  const env = (process.env["OPENCODE_LOG_LEVEL"] ?? "INFO").toUpperCase()
  return LEVELS[env as LevelName] ?? LEVELS.INFO
}

export type Logger = {
  debug(message?: any, extra?: Record<string, any>): void
  info(message?: any, extra?: Record<string, any>): void
  warn(message?: any, extra?: Record<string, any>): void
  error(message?: any, extra?: Record<string, any>): void
  tag(key: string, value: string): Logger
  clone(): Logger
  time(message: string, extra?: Record<string, any>): { stop(): void; [Symbol.dispose](): void }
}

const cache = new Map<string, Logger>()

export function create(tags: Record<string, any> = {}): Logger {
  const service = typeof tags["service"] === "string" ? (tags["service"] as string) : undefined
  if (service && cache.has(service)) return cache.get(service)!

  const format = (level: LevelName, message: any, extra?: Record<string, any>) => {
    const merged = { ...tags, ...extra }
    const fields = Object.entries(merged)
      .filter(([, v]) => v !== undefined)
      .map(([k, v]) => `${k}=${typeof v === "string" ? v : JSON.stringify(v)}`)
      .join(" ")
    return [new Date().toISOString().split(".")[0], level.padEnd(5), message, fields].filter(Boolean).join(" ")
  }

  const emit = (level: LevelName, message?: any, extra?: Record<string, any>) => {
    if (LEVELS[level] < threshold()) return
    const line = format(level, message, extra)
    if (level === "ERROR" || level === "WARN") process.stderr.write(line + "\n")
    else process.stdout.write(line + "\n")
  }

  const result: Logger = {
    debug: (m, e) => emit("DEBUG", m, e),
    info: (m, e) => emit("INFO", m, e),
    warn: (m, e) => emit("WARN", m, e),
    error: (m, e) => emit("ERROR", m, e),
    tag(key, value) {
      tags[key] = value
      return result
    },
    clone() {
      return create({ ...tags })
    },
    time(message, extra) {
      const start = Date.now()
      result.info(message, { status: "started", ...extra })
      const stop = () => result.info(message, { status: "completed", duration: Date.now() - start, ...extra })
      return { stop, [Symbol.dispose]: stop }
    },
  }

  if (service) cache.set(service, result)
  return result
}

export const Default = create({ service: "default" })
