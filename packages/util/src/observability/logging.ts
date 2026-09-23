import { Effect, FileSystem, Formatter, Logger, Option, Schedule, Stream, type LogLevel } from "effect"
import path from "path"
import { Global } from "../global.js"
import { runID } from "./shared.js"

// One log file is shared by every opencode process on the machine and only ever appended to, so it
// is bounded by compacting in place instead of rotating: once it passes LOG_MAX_BYTES the head is
// dropped so roughly LOG_KEEP_BYTES remain, rounded forward to the next line boundary.
export const LOG_MAX_BYTES = 50 * 1024 * 1024
export const LOG_KEEP_BYTES = 25 * 1024 * 1024
export const LOG_TRIM_INTERVAL = "1 hour"
// A trim of a 1 GB log takes well under a second, so a lock older than this belongs to a dead process.
export const LOG_TRIM_LOCK_STALE_MS = 5 * 60 * 1000
const LOG_TRIM_CHUNK = 64 * 1024

function formatter(id: string = runID()) {
  return Logger.map(Logger.formatStructured, (output) => {
    const messages = Array.isArray(output.message) ? output.message : [output.message]
    return [
      ["timestamp", output.timestamp],
      ["level", output.level],
      ["run", id],
      ...messages.flatMap((value) => (plain(value) ? flatten(value) : [["message", value] as const])),
      ...(output.cause === undefined ? [] : [["cause", output.cause] as const]),
      ...flatten(output.spans),
      ...flatten(output.annotations),
    ]
      .map(([key, value]) => `${key}=${format(value)}`)
      .join(" ")
  })
}

function flatten(
  input: Record<string, unknown>,
  prefix = "",
  seen = new WeakSet<object>(),
): Array<readonly [string, unknown]> {
  if (seen.has(input)) return [[prefix, "[Circular]"]]
  seen.add(input)
  const entries = Object.entries(input)
  if (entries.length === 0 && prefix) return [[prefix, input]]
  return entries.flatMap(([key, value]) => {
    const path = prefix ? `${prefix}.${key}` : key
    return plain(value) ? flatten(value, path, seen) : [[path, value] as const]
  })
}

function plain(input: unknown): input is Record<string, unknown> {
  if (input === null || typeof input !== "object" || Array.isArray(input)) return false
  const prototype = Object.getPrototypeOf(input)
  return prototype === Object.prototype || prototype === null
}

function format(input: unknown) {
  const value = typeof input === "string" ? input : Formatter.format(input)
  return /^[^\s="\\]+$/.test(value) ? value : JSON.stringify(value)
}

export function file(local = true, channel = "local") {
  if (!local) return path.join(Global.Path.log, "opencode.log")
  return path.join(Global.Path.log, `opencode-${channel.replace(/[^a-zA-Z0-9._-]/g, "-")}.log`)
}

export function fileLogger(target = file(), id: string = runID()) {
  // Do not set batchWindow to 0; it causes high idle CPU usage.
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    yield* fs.makeDirectory(path.dirname(target), { recursive: true })
    const logger = yield* Logger.toFile(formatter(id), target, { flag: "a" })
    yield* trim(target).pipe(
      Effect.ignore,
      Effect.repeat(Schedule.spaced(LOG_TRIM_INTERVAL)),
      Effect.forkScoped({ startImmediately: true }),
    )
    return logger
  })
}

// Compacts in place rather than writing a temp file and renaming over the log. Other processes hold
// the same file open with O_APPEND, so they keep appending to the compacted file, whereas a rename
// would strand them on the unlinked inode and lose their output.
//
// Appenders are not coordinated with the final truncate, so a batch flushed by another process
// between the last read and the truncate is lost. That window is a few milliseconds once per trim,
// which is an accepted trade for not wrapping every log write in a cross-process lock.
export const trim = Effect.fn("Logging.trim")(function* (
  target: string,
  options: { max?: number; keep?: number } = {},
) {
  const max = options.max ?? LOG_MAX_BYTES
  const keep = options.keep ?? LOG_KEEP_BYTES
  const fs = yield* FileSystem.FileSystem
  // Every opencode process on the machine runs this against the same file. Two trimmers racing
  // would have one compute its cut from a size the other already shrank, so only one may proceed
  // and the rest skip until the next interval. mkdir is the atomic primitive on every platform.
  // acquireRelease keeps the mkdir uninterruptible, so a scope closing mid-call cannot leave a lock
  // on disk with no finalizer registered to remove it.
  const lock = `${target}.trim`
  const acquired = yield* Effect.acquireRelease(
    fs.makeDirectory(lock).pipe(
      Effect.as(true),
      Effect.catchIf(
        (error) => error.reason._tag === "AlreadyExists",
        () => breakStaleLock(fs, lock),
      ),
    ),
    (acquired) => (acquired ? fs.remove(lock, { recursive: true }).pipe(Effect.ignore) : Effect.void),
  )
  if (!acquired) return
  const size = Number((yield* fs.stat(target)).size)
  if (size <= max) return
  const handle = yield* fs.open(target, { flag: "r+" })
  const start = yield* lineStart(handle, size - keep)
  yield* handle.seek(0, "start")
  // Reads run to the current EOF so lines appended since the stat survive; the write cursor always
  // trails the read cursor so the forward copy never overwrites unread bytes.
  const written = yield* fs.stream(target, { offset: start, chunkSize: LOG_TRIM_CHUNK }).pipe(
    Stream.runFoldEffect(
      () => 0,
      (total, chunk) => handle.writeAll(chunk).pipe(Effect.as(total + chunk.length)),
    ),
  )
  yield* handle.truncate(written)
}, Effect.scoped)

// Removes a lock left by a process that died mid-trim. Still yields this round: the next interval
// acquires cleanly, and a process that is legitimately trimming right now keeps its lock.
//
// Two processes that both observe the same stale lock can race here: one removes it, a third
// acquires fresh, and the other removes that fresh lock. That needs a crash inside a sub-second trim
// followed by three processes ticking within the same few milliseconds, and the consequence is the
// same bounded tail loss documented on `trim`. Not worth a breaker protocol; see EffectFlock if it is.
function breakStaleLock(fs: FileSystem.FileSystem, lock: string) {
  return Effect.gen(function* () {
    const info = yield* fs.stat(lock).pipe(Effect.option)
    const modified = Option.flatMap(info, (value) => value.mtime)
    if (Option.isNone(modified)) return false
    if (Date.now() - modified.value.getTime() < LOG_TRIM_LOCK_STALE_MS) return false
    yield* fs.remove(lock, { recursive: true }).pipe(Effect.ignore)
    return false
  })
}

// First byte after the first newline at or beyond `from`, or EOF when the tail has no newline.
function lineStart(handle: FileSystem.File, from: number) {
  return Effect.gen(function* () {
    let cursor = from
    while (true) {
      yield* handle.seek(cursor, "start")
      const chunk = yield* handle.readAlloc(LOG_TRIM_CHUNK)
      if (Option.isNone(chunk)) return cursor
      const newline = chunk.value.indexOf(10)
      if (newline !== -1) return cursor + newline + 1
      cursor += chunk.value.length
    }
  })
}

const stderrLogger = Logger.make((options) => {
  if (process.env.OPENCODE_PRINT_LOGS !== "1") return
  process.stderr.write(formatter().log(options) + "\n")
})

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

export function loggers(local = true, channel = "local") {
  return [fileLogger(file(local, channel)), stderrLogger]
}

export * as Logging from "./logging.js"
