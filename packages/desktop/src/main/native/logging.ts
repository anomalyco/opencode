export * as DesktopLogging from "./logging"

import log from "electron-log/main.js"
import { app, crashReporter, netLog, shell } from "electron"
import {
  Cause,
  Context,
  Effect,
  Exit,
  FiberSet,
  FileSystem,
  Layer,
  Logger,
  Option,
  Path,
  Predicate,
  References,
  Stream,
} from "effect"
import { homedir } from "node:os"
import { VERSION } from "../constants"
import { marks } from "../lifecycle/marks"
import {
  EXPORT_ARCHIVE_TIMEOUT_MS,
  initialLoggingState,
  NETLOG_TIMEOUT_MS,
  transitionLogging,
  type ExportReply,
  type LoggingCommand,
  type LoggingEvent,
} from "./logging-machine"

const MAX_LOG_AGE_DAYS = 7

const EXPORT_WINDOW = 24 * 60 * 60 * 1000

const MAX_EXPORT_FILE_SIZE = 50 * 1024 * 1024

const NET_LOG_SIZE = 20 * 1024 * 1024

let root = ""

let run = ""

export interface Interface {
  readonly startNetwork: Effect.Effect<void>
  readonly startCrashReporter: Effect.Effect<void>
  readonly exportDebug: Effect.Effect<string>
}

export class Service extends Context.Service<Service, Interface>()("opencode/desktop/DesktopLogging") {}

const serviceLayer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    yield* initLogging(fs, path).pipe(Effect.orDie)
    // Old run directories go away in the background; listing them is not worth a wait at startup.
    yield* Effect.forkScoped(cleanup(fs, path).pipe(Effect.catch(() => Effect.void)))
    marks.logging = Date.now()
    yield* Effect.logInfo("app starting", {
      version: VERSION,
      packaged: app.isPackaged,
      onboardingTest: process.env.OPENCODE_TEST_ONBOARDING === "1",
      marks,
    })
    const fibers = yield* FiberSet.make()
    const runFiber = yield* FiberSet.runtime(fibers)()
    const current = { state: initialLoggingState() }

    const dispatch = (event: LoggingEvent) => {
      const next = transitionLogging(current.state, event)
      current.state = next.state
      next.commands.forEach(perform)
    }

    // Every exit, defects included, reports back as an event. An interrupt only happens on disposal, which the
    // machine already left.
    const report = (
      effect: Effect.Effect<LoggingEvent, unknown>,
      failed: (error: Error) => Effect.Effect<LoggingEvent>,
    ) =>
      void runFiber(
        effect.pipe(
          Effect.exit,
          Effect.flatMap((exit) => {
            if (Exit.isSuccess(exit)) return Effect.sync(() => dispatch(exit.value))

            if (Cause.hasInterruptsOnly(exit.cause)) return Effect.void

            const error = Cause.squash(exit.cause)

            return failed(error instanceof Error ? error : new Error(String(error))).pipe(
              Effect.flatMap((event) => Effect.sync(() => dispatch(event))),
            )
          }),
        ),
      )

    const perform = (command: LoggingCommand) => {
      if (command.type === "start-netlog") {
        const attempt = command.attempt

        return report(
          Effect.suspend(() => {
            const target = path.join(run, "network.netlog")

            if (netLog.currentlyLogging) return Effect.succeed(target)

            return Effect.tryPromise(() =>
              netLog.startLogging(target, { captureMode: "default", maxFileSize: NET_LOG_SIZE }),
            ).pipe(Effect.as(target))
          }).pipe(
            Effect.timeoutOrElse({
              duration: NETLOG_TIMEOUT_MS,
              orElse: () => Effect.fail(new Error("net log timed out")),
            }),
            Effect.tap((target) => scoped("network", Effect.logInfo("net log started", { path: target }))),
            Effect.map((target): LoggingEvent => ({ type: "netlog.started", attempt, path: target })),
          ),
          (error) =>
            scoped("network", Effect.logWarning(`failed to ${command.mode} net log`, { error })).pipe(
              Effect.map((): LoggingEvent => ({ type: "netlog.start-failed", attempt })),
            ),
        )
      }

      if (command.type === "stop-netlog") {
        const attempt = command.attempt

        return report(
          Effect.suspend(() =>
            netLog.currentlyLogging ? Effect.tryPromise(() => netLog.stopLogging()) : Effect.void,
          ).pipe(
            Effect.timeoutOrElse({
              duration: NETLOG_TIMEOUT_MS,
              orElse: () => Effect.fail(new Error("net log timed out")),
            }),
            Effect.map((): LoggingEvent => ({ type: "netlog.stopped", attempt })),
          ),
          (error) =>
            scoped("network", Effect.logWarning("failed to stop net log", { error })).pipe(
              Effect.map((): LoggingEvent => ({ type: "netlog.stopped", attempt })),
            ),
        )
      }

      if (command.type === "write-archive") {
        const attempt = command.attempt

        return report(
          writeDebugArchive(fs, path, command.netLogPath).pipe(
            Effect.timeoutOrElse({
              duration: EXPORT_ARCHIVE_TIMEOUT_MS,
              orElse: () => Effect.fail(new Error("Debug log export timed out")),
            }),
            Effect.map((output): LoggingEvent => ({ type: "archive.succeeded", attempt, output })),
          ),
          (error) =>
            Effect.logError("failed to export debug logs", { error }).pipe(
              Effect.map((): LoggingEvent => ({ type: "archive.failed", attempt, error })),
            ),
        )
      }

      if (command.type === "resolve-export") return command.replies.forEach((reply) => reply.resolve(command.output))

      command.replies.forEach((reply) => reply.reject(command.error))
    }

    yield* Effect.addFinalizer(() => Effect.sync(() => dispatch({ type: "disposed" })))

    return Service.of({
      startNetwork: Effect.sync(() => dispatch({ type: "network.requested" })),
      // Starting crashpad spawns its handler process, ~60 ms on the main thread, so the first window
      // and its IPC port come first.
      startCrashReporter: initCrashReporter(fs, path).pipe(
        Effect.tap(() => Effect.sync(() => (marks.crash = Date.now()))),
        Effect.catch((error) => Effect.logWarning("failed to start crash reporter", { error })),
      ),
      // A second export while one runs (another window, a retry after the error page gave up) joins it.
      exportDebug: Effect.callback<string>((resume) => {
        const reply: ExportReply = {
          resolve: (output) => resume(Effect.succeed(output)),
          reject: (error) => resume(Effect.die(error)),
        }

        dispatch({ type: "export.requested", reply })

        return Effect.sync(() => dispatch({ type: "export.cancelled", reply }))
      }),
    })
  }),
)

const nativeLogger = Logger.make((options) => {
  try {
    if (!run) return
    const entry = Logger.formatStructured.log(options)
    const scope = Predicate.isString(entry.annotations.scope) ? entry.annotations.scope : "main"
    const annotations = Object.fromEntries(Object.entries(entry.annotations).filter(([key]) => key !== "scope"))

    const context = Object.fromEntries(
      Object.entries({
        annotations: Object.keys(annotations).length === 0 ? undefined : annotations,
        spans: Object.keys(entry.spans).length === 0 ? undefined : entry.spans,
        cause: entry.cause,
      }).filter(([, value]) => value !== undefined),
    )

    const messages = Array.isArray(options.message) ? options.message : [options.message]
    log
      .scope(safeLogName(scope))
      [methods[options.logLevel]](...messages, ...(Object.keys(context).length === 0 ? [] : [context]))
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

function writeDebugArchive(fs: FileSystem.FileSystem, path: Path.Path, netLogPath: string | undefined) {
  return Effect.gen(function* () {
    const output = path.join(app.getPath("downloads"), `opencode-debug-${stamp()}.zip`)
    yield* Effect.logInfo("exporting debug logs", { output })

    const files = [
      ...(yield* collect(fs, path, root, "desktop")),
      ...(yield* Effect.forEach(serverLogRoots(path), (dir, i) => collect(fs, path, dir, `server-${i + 1}`))).flat(),
      ...(yield* collect(fs, path, app.getPath("crashDumps"), "crashpad")),
    ]

    const truncated = files.flatMap((file) => (file.offset > 0 ? [file.name] : []))
    yield* writeZip(fs, output, [
      {
        name: "manifest.json",
        data: Buffer.from(JSON.stringify({ ...manifest(path, netLogPath), truncated }, null, 2)),
      },
      ...files,
    ])
    yield* Effect.sync(() => shell.showItemInFolder(output))

    return output
  })
}

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

function manifest(path: Path.Path, netLogPath: string | undefined) {
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

  return [...new Set([path.join(xdgData, "opencode", "log"), path.join(app.getPath("userData"), "opencode", "log")])]
}

type Entry = { name: string; path: string; offset: number } | { name: string; data: Uint8Array }

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

        if (file.endsWith(".heapsnapshot")) return null
        // Server logs append forever without rotation, so the active log is often the largest
        // file. Export its tail rather than dropping the most relevant file from the bundle.
        const offset = Math.max(0, Number(info.size) - MAX_EXPORT_FILE_SIZE)

        return { name: path.join(prefix, entry).replace(/\\/g, "/"), path: file, offset }
      }),
    )).filter((entry) => entry !== null)
  })
}

function writeZip(fs: FileSystem.FileSystem, output: string, entries: Entry[]) {
  return Effect.gen(function* () {
    const { BlobReader, BlobWriter, ZipWriter } = yield* Effect.promise(() => import("@zip.js/zip.js"))
    // macOS Archive Utility and ditto reject bit-3 data descriptors without the PK\x07\x08 signature.
    const writer = new ZipWriter(new BlobWriter("application/zip"), { dataDescriptorSignature: true })
    yield* Effect.forEach(
      entries,
      (entry) =>
        Effect.gen(function* () {
          const data =
            "data" in entry
              ? entry.data
              : entry.offset === 0
                ? yield* fs.readFile(entry.path)
                : Buffer.concat(yield* Stream.runCollect(fs.stream(entry.path, { offset: entry.offset })))

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

function isBrokenPipe(cause: unknown) {
  return Predicate.hasProperty(cause, "code") && cause.code === "EPIPE"
}

export function scoped(name: string, effect: Effect.Effect<void>) {
  return effect.pipe(Effect.annotateLogs("scope", name))
}
