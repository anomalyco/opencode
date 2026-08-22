export * as DesktopLogging from "./logging"

import log from "electron-log/main.js"
import { app, crashReporter, netLog, shell } from "electron"
import { Context, Effect, FileSystem, Layer, Logger, Option, Path, References } from "effect"
import { homedir } from "node:os"
import { VERSION } from "../constants"

const MAX_LOG_AGE_DAYS = 7
const TAIL_LINES = 1000
const EXPORT_WINDOW = 24 * 60 * 60 * 1000
const MAX_EXPORT_FILE_SIZE = 50 * 1024 * 1024
const NET_LOG_SIZE = 20 * 1024 * 1024

let root = ""
let run = ""
let netLogPath: string | undefined

export interface Interface {
  readonly startNetwork: Effect.Effect<void>
  readonly exportDebug: Effect.Effect<string>
}

export class Service extends Context.Service<Service, Interface>()("opencode/desktop/DesktopLogging") {}

const serviceLayer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    yield* initLogging(fs, path).pipe(Effect.orDie)
    yield* initCrashReporter(fs, path).pipe(Effect.orDie)
    yield* Effect.logInfo("app starting", {
      version: VERSION,
      packaged: app.isPackaged,
      onboardingTest: process.env.OPENCODE_TEST_ONBOARDING === "1",
    })
    const exportDebug = exportDebugLogsEffect(fs, path).pipe(Effect.orDie)
    return Service.of({
      startNetwork: startNetLog(path).pipe(
        Effect.catch((error) => Effect.logWarning("failed to start net log", { error })),
      ),
      exportDebug,
    })
  }),
)

const nativeLogger = Logger.make((options) => {
  try {
    if (!run) return
    const entry = Logger.formatStructured.log(options)
    const scope = typeof entry.annotations.scope === "string" ? entry.annotations.scope : "main"
    const annotations = Object.fromEntries(Object.entries(entry.annotations).filter(([key]) => key !== "scope"))
    const context = {
      ...(Object.keys(annotations).length === 0 ? {} : { annotations }),
      ...(Object.keys(entry.spans).length === 0 ? {} : { spans: entry.spans }),
      ...(entry.cause === undefined ? {} : { cause: entry.cause }),
    }
    const messages = Array.isArray(options.message) ? options.message : [options.message]
    log.scope(safeLogName(scope))[methods[options.logLevel]](
      ...messages,
      ...(Object.keys(context).length === 0 ? [] : [context]),
    )
  } catch {
    // Logging must not interrupt application work.
  }
})

const methods = {
  All: "silly",
  Trace: "silly",
  Debug: "debug",
  Info: "info",
  Warn: "warn",
  Error: "error",
  Fatal: "error",
  None: "silly",
} as const

const nativeLoggerLayer = Layer.merge(
  Logger.layer([nativeLogger], { mergeWithExisting: false }),
  Layer.succeed(References.MinimumLogLevel, "All"),
)

export const layer = serviceLayer.pipe(Layer.provideMerge(nativeLoggerLayer))

function initLogging(fs: FileSystem.FileSystem, path: Path.Path) {
  return Effect.gen(function* () {
    yield* initRunDirectory(fs, path)
    yield* Effect.sync(() => {
      log.transports.file.maxSize = 5 * 1024 * 1024
      log.transports.file.resolvePathFn = (_vars, message) =>
        path.join(
          run,
          `${safeLogName(message?.scope ?? (message?.variables?.processType === "renderer" ? "renderer" : "main"))}.log`,
        )
      log.initialize({ preload: false, spyRendererConsole: true })
      initConsoleTransport()
    })
    yield* cleanup(fs, path)
  })
}

function initCrashReporter(fs: FileSystem.FileSystem, path: Path.Path) {
  return Effect.gen(function* () {
    const dir = path.join(app.getPath("userData"), "Crashpad")
    yield* fs.makeDirectory(dir, { recursive: true })
    yield* Effect.sync(() => {
      app.setPath("crashDumps", dir)
      crashReporter.start({ uploadToServer: false, compress: true })
    })
    yield* scoped("crash", Effect.logInfo("crash reporter started", { path: dir }))
  })
}

function startNetLog(path: Path.Path) {
  if (netLog.currentlyLogging) return Effect.void
  const target = path.join(run, "network.netlog")
  netLogPath = target
  return Effect.tryPromise(() => netLog.startLogging(target, { captureMode: "default", maxFileSize: NET_LOG_SIZE })).pipe(
    Effect.tap(() => scoped("network", Effect.logInfo("net log started", { path: target }))),
  )
}

function exportDebugLogsEffect(fs: FileSystem.FileSystem, path: Path.Path) {
  return Effect.gen(function* () {
    const restartNetLog = netLog.currentlyLogging
    if (restartNetLog) {
      yield* Effect.tryPromise(() => netLog.stopLogging()).pipe(
        Effect.catch((error) => scoped("network", Effect.logWarning("failed to stop net log", { error }))),
      )
    }

    const output = path.join(app.getPath("downloads"), `opencode-debug-${stamp()}.zip`)
    return yield* Effect.gen(function* () {
      yield* Effect.logInfo("exporting debug logs", { output })
      yield* writeZip(fs, output, [
        { name: "manifest.json", data: Buffer.from(JSON.stringify(manifest(path), null, 2)) },
        ...(yield* collect(fs, path, root, "desktop")),
        ...(yield* Effect.forEach(serverLogRoots(path), (dir, i) => collect(fs, path, dir, `server-${i + 1}`))).flat(),
        ...(yield* collect(fs, path, app.getPath("crashDumps"), "crashpad")),
      ])
      yield* Effect.sync(() => shell.showItemInFolder(output))
      return output
    }).pipe(
      Effect.ensuring(
        restartNetLog
          ? startNetLog(path).pipe(
              Effect.catch((error) =>
                scoped("network", Effect.logWarning("failed to restart net log", { error })),
              ),
            )
          : Effect.void,
      ),
    )
  })
}

export const tail = Effect.fn("DesktopLogging.tail")(function* () {
  const fs = yield* FileSystem.FileSystem
  return yield* Effect.gen(function* () {
    const path = log.transports.file.getFile().path
    const contents = yield* fs.readFileString(path)
    const lines = contents.split("\n")
    return lines.slice(Math.max(0, lines.length - TAIL_LINES)).join("\n")
  }).pipe(Effect.orElseSucceed(() => ""))
})

function initRunDirectory(fs: FileSystem.FileSystem, path: Path.Path) {
  root = path.join(app.getPath("userData"), "logs")
  run = path.join(root, stamp())
  return fs.makeDirectory(run, { recursive: true })
}

function stamp() {
  return new Date()
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d+Z$/, "")
}

function safeLogName(name: string) {
  return name.replace(/[^a-z0-9_.-]/gi, "_") || "main"
}

function cleanup(fs: FileSystem.FileSystem, path: Path.Path) {
  return Effect.gen(function* () {
    const dir = root || path.dirname(log.transports.file.getFile().path)
    const cutoff = Date.now() - MAX_LOG_AGE_DAYS * 24 * 60 * 60 * 1000
    const entries = yield* fs.readDirectory(dir)
    yield* Effect.forEach(
      entries,
      (entry) =>
        Effect.gen(function* () {
          const file = path.join(dir, entry)
          const info = yield* fs.stat(file)
          if (Option.getOrElse(info.mtime, () => new Date(0)).getTime() < cutoff) {
            yield* fs.remove(file, { recursive: true, force: true })
          }
        }).pipe(Effect.catch(() => Effect.void)),
      { discard: true },
    )
  })
}

function manifest(path: Path.Path) {
  return {
    generated: new Date().toISOString(),
    version: VERSION,
    name: app.getName(),
    packaged: app.isPackaged,
    platform: process.platform,
    arch: process.arch,
    versions: process.versions,
    uptime: process.uptime(),
    userData: app.getPath("userData"),
    logs: root,
    currentRun: run,
    crashDumps: app.getPath("crashDumps"),
    serverLogs: serverLogRoots(path),
    netLog: netLogPath,
  }
}

function serverLogRoots(path: Path.Path) {
  const xdgData = process.env.XDG_DATA_HOME || path.join(homedir(), ".local", "share")
  return [
    ...new Set([path.join(xdgData, "opencode", "log"), path.join(app.getPath("userData"), "opencode", "log")]),
  ]
}

type Entry = { name: string; path: string } | { name: string; data: Uint8Array }

function collect(fs: FileSystem.FileSystem, path: Path.Path, dir: string, prefix: string) {
  return Effect.gen(function* () {
    if (!(yield* fs.exists(dir).pipe(Effect.orElseSucceed(() => false)))) return []
    const cutoff = Date.now() - EXPORT_WINDOW
    const entries = yield* fs.readDirectory(dir, { recursive: true })
    return (yield* Effect.forEach(entries, (entry) =>
      Effect.gen(function* () {
        const file = path.join(dir, entry)
        const info = yield* fs.stat(file)
        if (info.type === "Directory") return null
        if (Option.getOrElse(info.mtime, () => new Date(0)).getTime() < cutoff) return null
        if (info.size > FileSystem.Size(MAX_EXPORT_FILE_SIZE)) return null
        if (file.endsWith(".heapsnapshot")) return null
        return { name: path.join(prefix, entry).replace(/\\/g, "/"), path: file }
      }),
    )).filter((entry) => entry !== null)
  })
}

function writeZip(fs: FileSystem.FileSystem, output: string, entries: Entry[]) {
  return Effect.gen(function* () {
    const { BlobReader, BlobWriter, ZipWriter } = yield* Effect.promise(() => import("@zip.js/zip.js"))
    const writer = new ZipWriter(new BlobWriter("application/zip"))
    yield* Effect.forEach(
      entries,
      (entry) =>
        Effect.gen(function* () {
          const data = "data" in entry ? entry.data : yield* fs.readFile(entry.path)
          yield* Effect.tryPromise(() => writer.add(entry.name, new BlobReader(new Blob([new Uint8Array(data)]))))
        }),
      { concurrency: 1, discard: true },
    )
    const zip = yield* Effect.tryPromise(() => writer.close())
    yield* fs.writeFile(output, new Uint8Array(yield* Effect.tryPromise(() => zip.arrayBuffer())))
  })
}

function initConsoleTransport() {
  if (app.isPackaged) {
    log.transports.console.level = false
    return
  }

  const writeConsole = log.transports.console.writeFn.bind(log.transports.console)
  log.transports.console.writeFn = (options) => {
    try {
      writeConsole(options)
    } catch (err) {
      if (!isBrokenPipe(err)) throw err
      log.transports.console.level = false
    }
  }
}

function isBrokenPipe(err: unknown) {
  return typeof err === "object" && err !== null && "code" in err && err.code === "EPIPE"
}

export function scoped(name: string, effect: Effect.Effect<void>) {
  return effect.pipe(Effect.annotateLogs("scope", name))
}
