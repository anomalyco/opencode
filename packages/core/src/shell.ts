export * as Shell from "./shell.js"

import path from "path"
import {
  Context,
  Deferred,
  Duration,
  Effect,
  Exit,
  Fiber,
  Latch,
  Layer,
  Option,
  Schema,
  Schedule,
  Stream,
} from "effect"
import { ChildProcess } from "effect/process"
import { produce } from "immer"
import { Shell } from "@opencode/schema/shell"
import { AppProcess } from "@opencode/util/process"
import { CrossSpawnSpawner } from "@opencode/util/cross-spawn-spawner"
import { makeGlobalNode, makeLocationNode } from "@opencode/util/effect/app-node"
import { FSUtil } from "@opencode/util/fs-util"
import { Bus } from "./bus.js"
import { Environment } from "./environment/index.js"
import { FileRetention } from "./file-retention.js"
import { Location } from "./location.js"
import { LocationLifecycle } from "./location-lifecycle.js"
import { Detaching } from "./detaching.js"
import { Global } from "@opencode/util/global"
import { PersistentPty } from "./persistent-pty.js"
import { ShellSelect } from "./shell/select.js"
import type { ShellCreateBefore } from "@opencode/plugin/effect/shell"
import { PluginHooks } from "./plugin/hooks.js"
import { SessionEnvironment } from "./session/environment.js"
import { SessionSchema } from "./session/schema.js"
import { Config } from "./config.js"
import { ToolOutput } from "./tool-output.js"
import { ShellResult } from "./shell/result.js"

export class NotFoundError extends Schema.TaggedError<NotFoundError>()("Shell.NotFoundError", {
  id: Shell.ID,
}) {}

// Keep recent exited processes observable in memory, including their file-backed output.
// The process-local cap complements the time-based sweep, which also cleans files left by restarts.
const EXITED_LIMIT = 25
export const RETENTION = Duration.days(7)
export const DIRECTORY = "shell"
const STOP_GRACE = Duration.seconds(3)

type Info = Shell.Info
export type StopReason = "timeout" | "killed"

/** The tool call that started a command, so a server that took over can settle it. */
export const ToolCall = Schema.Struct({
  sessionID: Schema.String,
  assistantMessageID: Schema.String,
  callID: Schema.String,
})
export type ToolCall = typeof ToolCall.Type

type CreateInput = Shell.CreateInput & {
  shell?: string
  toolCall?: ToolCall
}

// What the server needs to take a daemon-run command back after a restart, kept in the daemon's metadata.
const Stored = Schema.Struct({
  id: Shell.ID,
  command: Schema.String,
  shell: Schema.String,
  location: Schema.Struct({ directory: Schema.String, workspaceID: Schema.optionalKey(Schema.String) }),
  metadata: Shell.Metadata,
  toolCall: Schema.optional(ToolCall),
  timeoutDeadline: Schema.optional(Schema.Number),
  stopReason: Schema.optional(Schema.Literals(["timeout", "killed"])),
  backgroundedAtShutdown: Schema.optional(Schema.Boolean),
})
type Stored = typeof Stored.Type
const decodeStored = Schema.decodeUnknownOption(Stored)

// A command run by the process daemon, which writes and counts its output file.
type Daemon = {
  id: number
  stored: Stored
  // From the exit: newlines in the file, and why the daemon stopped writing it early.
  outputLines?: number
  outputError?: string
  wait?: Fiber.Fiber<void>
  kill?: Fiber.Fiber<void>
}

type Active = {
  // Immutable snapshot; lifecycle updates replace it via immer `produce`.
  info: Info
  file: string
  // Spawned commands only: bytes and newlines written so far. The daemon's file is the only count for its commands.
  size: number
  newlines: number
  // Resolves with the terminal Info once the command exits, times out, or is killed. A wait
  // started after termination resolves immediately from the already-completed deferred.
  done: Deferred.Deferred<Info, NotFoundError>
  timeoutFiber?: Fiber.Fiber<void>
  timeout?: (duration: number) => Effect.Effect<void>
  stop?: (reason: StopReason) => Effect.Effect<void>
  // Whether the process can outlive this server (run by the process daemon). Spawned commands cannot.
  detachable: boolean
  daemon?: Daemon
}

type Ended = {
  status: "exited" | StopReason
  exit?: number
  signal?: string
  completed: number
}

/**
 * Location-owned non-interactive shell command process service.
 *
 * Each `create` starts one shell command, captures combined stdout/stderr to a
 * file, and returns an ID. Clients poll `get` for status and `output` for
 * file-backed output by cursor. No session, message, or permission state lives
 * here; callers (e.g. `ShellTool`) own that association and store the shell ID.
 *
 * Local commands run in the process daemon when it is available, so they survive a planned server
 * restart; this service takes them back when it starts. Elsewhere they are spawned by the server.
 */
export interface Interface {
  readonly create: <E = never, R = never>(
    input: CreateInput,
    before?: (input: ShellCreateBefore) => Effect.Effect<void, E, R>,
  ) => Effect.Effect<Shell.Info, E | AppProcess.AppProcessError, R>
  // Currently running commands only; exited shells are retained for get/output but excluded here.
  readonly list: () => Effect.Effect<Shell.Info[]>
  readonly get: (id: Shell.ID) => Effect.Effect<Shell.Info, NotFoundError>
  // Resolves once the command reaches a terminal status, returning its final Info. Fails with
  // NotFoundError if the command is unknown or is removed before it terminates.
  readonly wait: (id: Shell.ID) => Effect.Effect<Shell.Info, NotFoundError>
  // A known shell's terminal state and bounded tail. Missing capture remains distinct from its exit status.
  readonly result: (started: Shell.Info) => Effect.Effect<ShellResult.Result>
  // Replaces the running command's timeout from now; zero clears it. Ignored once the command has
  // ended or timed out, even while its process is still being killed or its output captured.
  readonly timeout: (id: Shell.ID, duration: number) => Effect.Effect<Shell.Info, NotFoundError>
  // Stops a running command gracefully (SIGTERM, then SIGKILL after 3 s) without forgetting it: it ends
  // with the given status and stays observable, file included, until retention evicts it. Returns at
  // once; `wait` observes the exit. Ignored once the command has ended or is already stopping.
  readonly stop: (id: Shell.ID, reason: StopReason) => Effect.Effect<Shell.Info, NotFoundError>
  // Whether the command's process can outlive this server, so a planned shutdown leaves it running.
  readonly detachable: (id: Shell.ID) => boolean
  // Records in the daemon that a planned shutdown moved this running command to the background, clearing
  // its timeout, so the next server neither times it out nor waits on it. Best effort; spawned commands ignore it.
  readonly backgroundAtShutdown: (id: Shell.ID) => Effect.Effect<void>
  // The command a tool call started, while it is still known here (including one taken back after a restart).
  readonly byToolCall: (call: ToolCall) => Effect.Effect<Shell.Info | undefined>
  readonly output: (id: Shell.ID, input?: Shell.OutputInput) => Effect.Effect<Shell.Output, NotFoundError>
  readonly remove: (id: Shell.ID) => Effect.Effect<void, NotFoundError>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/Shell") {}

export const cleanup = Effect.fn("Shell.cleanup")(function* () {
  const fs = yield* FSUtil.Service
  const global = yield* Global.Service
  const pty = yield* PersistentPty.Service
  const directory = path.join(global.data, DIRECTORY)
  const projects = yield* fs.readDirectoryEntries(directory).pipe(
    Effect.map((entries) => entries.filter((entry) => entry.type === "Directory")),
    Effect.orElseSucceed(() => []),
  )
  const files = yield* Effect.forEach(
    projects,
    (project) =>
      fs.readDirectoryEntries(path.join(directory, project.name)).pipe(
        Effect.map((entries) =>
          entries.flatMap((entry) =>
            entry.type === "File" && /^sh_[0-9a-f]{12}.*\.out$/.test(entry.name)
              ? [path.join(directory, project.name, entry.name)]
              : [],
          ),
        ),
        Effect.orElseSucceed(() => []),
      ),
    { concurrency: 8 },
  )
  // Never starts the daemon. A command it still runs keeps its file; a finished one is forgotten before deletion.
  const processes = new Map(
    (yield* pty.listPipes().pipe(Effect.orElseSucceed(() => []))).map((process) => [process.outputPath, process]),
  )
  yield* FileRetention.cleanup(
    fs,
    files.flat().filter((file) => processes.get(file)?.lifecycle.status !== "running"),
    RETENTION,
    (file) => {
      const process = processes.get(file)
      return process ? pty.terminatePipe(process.id).pipe(Effect.ignore) : Effect.void
    },
  )
})

const cleanupLayer = Layer.effectDiscard(
  cleanup().pipe(Effect.repeat(Schedule.spaced(Duration.hours(1))), Effect.forkScoped),
)

const cleanupNode = makeGlobalNode({
  name: "shell-output-cleanup",
  layer: cleanupLayer,
  deps: [FSUtil.node, Global.node, PersistentPty.node],
})

const layer = () =>
  Layer.effect(
    Service,
    Effect.gen(function* () {
      const bus = yield* Bus.Service
      const location = yield* Location.Service
      const global = yield* Global.Service
      const shell = yield* ShellSelect.Service
      const environment = yield* Environment.Service
      const hooks = yield* PluginHooks.Service
      const environments = yield* SessionEnvironment.Service
      const config = yield* Config.Service
      const pty = yield* PersistentPty.Service
      const lifecycle = yield* LocationLifecycle.Service
      const detaching = yield* Detaching.Service
      const context = yield* Effect.context()
      const runFork = Effect.runForkWith(context)
      const commands = new Map<Shell.ID, Active>()
      const exitOrder: Shell.ID[] = []
      // Remote workspaces and Windows keep spawning commands from the server.
      const daemonEnabled =
        location.workspaceID === undefined && process.platform !== "win32" && PersistentPty.available

      const outputDir = path.join(global.data, DIRECTORY, location.project.id)
      const { mkdir, unlink, open } = yield* Effect.promise(() => import("fs/promises"))
      const { createWriteStream, createReadStream } = yield* Effect.promise(() => import("fs"))
      yield* Effect.promise(() => mkdir(outputDir, { recursive: true }))

      // A Location that closes while the server keeps running (a reload, an eviction) keeps watching the daemon's
      // commands it started: their exit, timeout and stop, so the jobs waiting on them still hear how they ended.
      // Its replacement, if one boots, takes the commands back too and is the one that reports and evicts them.
      yield* Effect.addFinalizer(() =>
        Effect.gen(function* () {
          const stopping = detaching.isStopping()
          for (const command of [...commands.values()]) {
            if (command.daemon && !stopping) continue
            if (command.timeoutFiber) yield* Fiber.interrupt(command.timeoutFiber)
            // On shutdown daemon commands are only detached from: their processes keep running for the next owner.
            if (command.daemon?.kill) yield* Fiber.interrupt(command.daemon.kill)
            if (command.daemon?.wait) yield* Fiber.interrupt(command.daemon.wait)
            // Teardown interrupts pending commands; it is not a terminal command failure. It never stops or
            // removes a command itself: a spawned process dies with its handle's scope once `done` settles.
            yield* Deferred.interrupt(command.done)
            commands.delete(command.info.id)
          }
          exitOrder.length = 0
        }),
      )

      let closed = false
      yield* lifecycle.awaitShutdown.pipe(
        Effect.andThen(
          Effect.sync(() => {
            closed = true
          }),
        ),
        Effect.forkScoped,
      )

      const require = Effect.fnUntraced(function* (id: Shell.ID) {
        const command = commands.get(id)
        if (!command) return yield* new NotFoundError({ id })
        return command
      })

      const removeCommand = Effect.fnUntraced(function* (id: Shell.ID) {
        const command = commands.get(id)
        const index = exitOrder.indexOf(id)
        if (index !== -1) exitOrder.splice(index, 1)
        if (!command) return
        commands.delete(id)
        if (command.timeoutFiber) yield* Fiber.interrupt(command.timeoutFiber)
        if (command.daemon) {
          if (command.daemon.kill) yield* Fiber.interrupt(command.daemon.kill)
          // Stop waiting first, so forgetting the process is not mistaken for losing it. Removal never runs on the
          // wait's own fiber: it settles the command through `finish`, which only evicts other commands.
          if (command.daemon.wait) yield* Fiber.interrupt(command.daemon.wait)
          // Forget the process before deleting its file.
          yield* pty.terminatePipe(command.daemon.id).pipe(Effect.ignore)
          yield* Effect.promise(() => unlink(command.file).catch(() => {}))
          yield* Deferred.fail(command.done, new NotFoundError({ id }))
        }
        if (!command.daemon) {
          // Unblock any wait still pending when the command is removed before it terminated.
          yield* Deferred.fail(command.done, new NotFoundError({ id }))
          yield* Effect.promise(() => unlink(command.file).catch(() => {}))
        }
        // Every shell reports exactly one exit; removing a running one ends it as killed.
        if (command.info.status === "running") yield* bus.publish(Shell.Event.Exited, { id, status: "killed" })
        yield* bus.publish(Shell.Event.Deleted, { id })
      })

      const evict = Effect.fnUntraced(function* () {
        while (exitOrder.length > EXITED_LIMIT) {
          const oldest = exitOrder[0]
          if (!oldest) break
          yield* removeCommand(oldest)
        }
      })

      // Records how a command ended, once, unless it was removed meanwhile.
      const finish = Effect.fnUntraced(function* (command: Active, outcome: Ended) {
        const id = command.info.id
        // A removed command already failed its waiters and published its exit and deletion.
        if (commands.get(id) !== command) return
        command.info = produce(command.info, (draft) => {
          draft.status = outcome.status
          if (outcome.exit !== undefined) draft.exit = outcome.exit
          if (outcome.signal !== undefined) draft.signal = outcome.signal
          draft.time.completed = outcome.completed
        })
        // The Location's replacement reports it and applies retention.
        if (closed && command.daemon) {
          yield* Deferred.succeed(command.done, command.info)
          return
        }
        // Resolve waiters before retention eviction, so an evicted command still reports its
        // terminal Info rather than the removal NotFoundError.
        yield* Deferred.succeed(command.done, command.info)
        yield* bus.publish(Shell.Event.Exited, {
          id,
          ...(outcome.exit !== undefined ? { exit: outcome.exit } : {}),
          status: outcome.status,
        })
        exitOrder.push(id)
        yield* evict()
        // Keep exited history data-only.
        const timeoutFiber = command.timeoutFiber
        command.timeout = undefined
        command.stop = undefined
        command.timeoutFiber = undefined
        if (timeoutFiber) yield* Fiber.interrupt(timeoutFiber)
      })

      const remove = Effect.fn("Shell.remove")(function* (id: Shell.ID) {
        yield* require(id)
        yield* removeCommand(id)
      })

      const list = Effect.fn("Shell.list")(function* () {
        return Array.from(commands.values())
          .filter((command) => command.info.status === "running")
          .map((command) => command.info)
      })

      const get = Effect.fn("Shell.get")(function* (id: Shell.ID) {
        return (yield* require(id)).info
      })

      const wait = Effect.fn("Shell.wait")(function* (id: Shell.ID) {
        return yield* Deferred.await((yield* require(id)).done)
      })

      const timeout = Effect.fn("Shell.timeout")(function* (id: Shell.ID, duration: number) {
        const command = yield* require(id)
        if (command.info.status !== "running" || !command.timeout) return command.info
        yield* command.timeout(duration)
        return command.info
      })

      const stop = Effect.fn("Shell.stop")(function* (id: Shell.ID, reason: StopReason) {
        const command = yield* require(id)
        if (command.info.status !== "running" || !command.stop) return command.info
        yield* command.stop(reason)
        return command.info
      })

      const detachable = (id: Shell.ID) => commands.get(id)?.detachable ?? false

      const backgroundAtShutdown = Effect.fn("Shell.backgroundAtShutdown")(function* (id: Shell.ID) {
        const command = commands.get(id)
        const daemon = command?.daemon
        if (!command || !daemon || command.info.status !== "running") return
        if (command.timeoutFiber) yield* Fiber.interrupt(command.timeoutFiber)
        command.timeoutFiber = undefined
        yield* store(daemon, { backgroundedAtShutdown: true, timeoutDeadline: undefined })
      })

      const byToolCall = Effect.fn("Shell.byToolCall")(function* (call: ToolCall) {
        return Array.from(commands.values()).find((command) => {
          const stored = command.daemon?.stored.toolCall
          return (
            stored?.sessionID === call.sessionID &&
            stored.assistantMessageID === call.assistantMessageID &&
            stored.callID === call.callID
          )
        })?.info
      })

      const readSpawned = (file: string, start: number, length: number) =>
        length <= 0
          ? Effect.succeed(Buffer.alloc(0))
          : Effect.promise(
              () =>
                new Promise<Buffer>((resolve) => {
                  const buffer = Buffer.alloc(length)
                  const stream = createReadStream(file, { start, end: start + length - 1 })
                  let offset = 0
                  stream.on("data", (chunk: string | Buffer) => {
                    const bytes = Buffer.from(chunk)
                    bytes.copy(buffer, offset)
                    offset += bytes.length
                  })
                  stream.on("end", () => resolve(buffer.subarray(0, offset)))
                  stream.on("error", () => resolve(Buffer.alloc(0)))
                }),
            )

      // Reads a daemon command's file, which is the only record of its output. `size` comes from the same open
      // handle; a missing file reads as empty.
      const readFile = (file: string, start: (size: number) => number, limit: number) =>
        Effect.promise(async () => {
          const handle = await open(file, "r").catch(() => undefined)
          if (!handle) return { size: 0, start: 0, bytes: Buffer.alloc(0) }
          try {
            const size = (await handle.stat()).size
            const from = Math.max(0, start(size))
            if (from >= size) return { size, start: from, bytes: Buffer.alloc(0) }
            const buffer = Buffer.alloc(Math.min(limit, size - from))
            const read = await handle.read(buffer, 0, buffer.length, from)
            return { size, start: from, bytes: buffer.subarray(0, read.bytesRead) }
          } catch {
            return { size: 0, start: 0, bytes: Buffer.alloc(0) }
          } finally {
            await handle.close()
          }
        })

      const output = Effect.fnUntraced(function* (id: Shell.ID, input?: Shell.OutputInput) {
        const command = yield* require(id)
        const cursor = input?.cursor ?? 0
        const limit = input?.limit ?? 65536
        if (command.daemon) {
          const page = yield* readFile(command.file, () => cursor, limit)
          if (cursor >= page.size) return { output: "", cursor: page.size, size: page.size, truncated: false }
          return {
            output: page.bytes.toString("utf8"),
            cursor: page.start + page.bytes.length,
            size: page.size,
            truncated: false,
          }
        }
        if (cursor >= command.size) return { output: "", cursor: command.size, size: command.size, truncated: false }
        const start = Math.max(0, cursor)
        const bytes = yield* readSpawned(command.file, start, Math.min(limit, command.size - start))
        return {
          output: bytes.toString("utf8"),
          cursor: start + bytes.length,
          size: command.size,
          truncated: false,
        }
      })

      // Only for a command whose exit report was lost; the daemon counts newlines otherwise.
      const countNewlines = (file: string) =>
        Effect.promise(
          () =>
            new Promise<number>((resolve) => {
              let count = 0
              const stream = createReadStream(file)
              stream.on("data", (chunk: string | Buffer) => {
                const bytes = Buffer.from(chunk)
                for (let index = bytes.indexOf(10); index !== -1; index = bytes.indexOf(10, index + 1)) count++
              })
              stream.on("end", () => resolve(count))
              stream.on("error", () => resolve(count))
            }),
        )

      // The last `maxBytes` of a finished command's output, the file's size and its newline count.
      const tail = Effect.fnUntraced(function* (command: Active, maxBytes: number) {
        if (!command.daemon) {
          const start = Math.max(0, command.size - maxBytes)
          const bytes = yield* readSpawned(command.file, start, command.size - start)
          return { text: bytes.toString("utf8"), size: command.size, newlines: command.newlines, error: undefined }
        }
        const page = yield* readFile(command.file, (size) => size - maxBytes, maxBytes)
        return {
          text: page.bytes.toString("utf8"),
          size: page.size,
          // The daemon's count, unless the command ended without its exit report (the daemon went away).
          newlines: command.daemon.outputLines ?? (yield* countNewlines(command.file)),
          error: command.daemon.outputError,
        }
      })

      const result = Effect.fn("Shell.result")(function* (started: Shell.Info) {
        const info = yield* wait(started.id).pipe(
          Effect.catchTag("Shell.NotFoundError", () =>
            Effect.succeed({ ...started, status: "killed" as const, time: { ...started.time, completed: Date.now() } }),
          ),
        )
        const capture = yield* Effect.gen(function* () {
          const limits = Config.latest(yield* config.entries(), "tool_output")
          const maxLines = limits?.max_lines ?? ToolOutput.MAX_LINES
          const maxBytes = limits?.max_bytes ?? ToolOutput.MAX_BYTES
          const page = yield* tail(yield* require(info.id), maxBytes)
          const lines = page.text.split("\n")
          if (page.text.endsWith("\n")) lines.pop()
          const truncated = page.size > maxBytes || lines.length > maxLines
          const text = lines.length > maxLines ? lines.slice(-maxLines).join("\n") : page.text
          const empty = page.size === 0
          const shown = empty ? 0 : Math.min(lines.length, maxLines)
          const total = empty ? 0 : Math.max(page.newlines + (page.text.endsWith("\n") ? 0 : 1), shown)
          const notice = truncated ? `\n\n${ShellResult.savedNotice({ shown, total }, info.file)}` : ""
          const error = page.error ? `\n\n[output file ${info.file} stopped early: ${page.error}]` : ""
          return { output: `${text || "(no output)"}${notice}${error}`, truncated, lines: { shown, total } }
        }).pipe(Effect.catchTag("Shell.NotFoundError", () => Effect.succeed(undefined)))
        return { info, capture }
      })

      // Replaces the command's daemon metadata, so a restart sees its latest timeout and stop reason.
      // Cleared fields are left out of the JSON.
      const store = (daemon: Daemon, patch: Partial<Stored>) => {
        daemon.stored = { ...daemon.stored, ...patch }
        return pty.setPipeMetadata(daemon.id, daemon.stored).pipe(
          Effect.catch((error) =>
            Effect.logWarning("failed to update shell command metadata", {
              id: daemon.stored.id,
              error: error.message,
            }),
          ),
        )
      }

      // The command's metadata as the daemon has it. A closed Location and its replacement can both watch one
      // command, so a timeout or stop recorded by either is read back from there.
      const latest = (daemon: Daemon) =>
        pty.getPipe(daemon.id).pipe(
          Effect.map((process) => Option.getOrUndefined(decodeStored(process.metadata))),
          Effect.catchTags({
            // Forgotten, or no daemon (which takes its processes with it).
            "PersistentPty.ProcessNotFoundError": () => Effect.succeed(undefined),
            "PersistentPty.UnavailableError": () => Effect.succeed(daemon.stored),
          }),
        )

      // Watches a command the daemon runs: its exit, timeout (in ms from now, none if undefined) and graceful
      // stop. Used for new commands and for running ones taken back after a restart.
      const attach = (command: Active, daemon: Daemon, timeout: number | undefined) => {
        const stopping = (reason: StopReason) =>
          Effect.gen(function* () {
            yield* store(daemon, { stopReason: reason, timeoutDeadline: undefined })
            yield* pty.signalPipe(daemon.id, "SIGTERM").pipe(Effect.ignore)
            const ended = yield* Deferred.await(command.done).pipe(Effect.timeoutOption(STOP_GRACE), Effect.exit)
            if (Exit.isSuccess(ended) && Option.isNone(ended.value))
              yield* pty.signalPipe(daemon.id, "SIGKILL").pipe(Effect.ignore)
          })

        // Detached, so interrupting the caller (a timer being retimed, removed or torn down) never cancels a
        // recorded stop. Only removal and teardown interrupt it.
        const stop = (reason: StopReason) =>
          Effect.sync(() => {
            if (daemon.stored.stopReason !== undefined) return
            daemon.stored = { ...daemon.stored, stopReason: reason }
            daemon.kill = runFork(stopping(reason))
          })
        command.stop = stop

        // Times out at `deadline`, unless the daemon's metadata says the timeout was cleared, moved or already hit.
        const arm = (duration: number, deadline: number | undefined) => {
          const expire: Effect.Effect<void> = Effect.gen(function* () {
            const current = yield* latest(daemon)
            if (!current) return
            daemon.stored = current
            if (current.stopReason !== undefined || current.backgroundedAtShutdown) return
            const moved = current.timeoutDeadline
            if (moved === undefined) return
            if (deadline !== undefined && moved > deadline) return arm(moved - deadline, moved)
            yield* stop("timeout")
          })
          command.timeoutFiber = runFork(Effect.sleep(Duration.millis(duration)).pipe(Effect.andThen(expire)))
        }

        command.timeout = (duration) =>
          Effect.gen(function* () {
            if (daemon.stored.stopReason !== undefined) return
            if (command.timeoutFiber) yield* Fiber.interrupt(command.timeoutFiber)
            command.timeoutFiber = undefined
            const deadline = duration === 0 ? undefined : Date.now() + duration
            yield* store(daemon, { timeoutDeadline: deadline })
            if (deadline !== undefined) arm(duration, deadline)
          })

        daemon.wait = runFork(
          pty.waitPipe(daemon.id).pipe(
            Effect.flatMap(
              Effect.fnUntraced(function* (exit): Effect.fn.Return<Ended> {
                daemon.outputLines = exit.outputLines
                daemon.outputError = exit.outputError
                // Another watcher of the command may have stopped it.
                const reason = daemon.stored.stopReason ?? (yield* latest(daemon))?.stopReason
                // A stopped command reports its reason, not the signal it was stopped with, as spawned ones do.
                if (reason) return { status: reason, completed: exit.exitedAt }
                return {
                  status: "exited",
                  ...(exit.exitCode !== undefined ? { exit: exit.exitCode } : {}),
                  ...(exit.signal !== undefined ? { signal: exit.signal } : {}),
                  completed: exit.exitedAt,
                }
              }),
            ),
            // The daemon went away (and its processes with it), or forgot the process: it was killed.
            Effect.catch((error) =>
              Effect.logWarning("lost a shell command's process", { id: command.info.id, error: error.message }).pipe(
                Effect.as<Ended>({ status: "killed", completed: Date.now() }),
              ),
            ),
            Effect.flatMap((outcome) => finish(command, outcome)),
          ),
        )

        // A stop interrupted by a restart lost its grace period: kill now.
        if (daemon.stored.stopReason !== undefined) {
          daemon.kill = runFork(pty.signalPipe(daemon.id, "SIGKILL").pipe(Effect.ignore))
          return
        }
        if (timeout === undefined) return
        if (timeout > 0) return arm(timeout, daemon.stored.timeoutDeadline)
        runFork(stop("timeout"))
      }

      const daemonCommand = (info: Info, daemon: Daemon): Active => ({
        info,
        file: info.file,
        size: 0,
        newlines: 0,
        done: Deferred.makeUnsafe<Info, NotFoundError>(),
        detachable: true,
        daemon,
      })

      // Runs the command in the daemon. Fails with `UnavailableError` only when the daemon could not be reached
      // or started, so the request never ran and spawning it here instead is safe.
      const createInDaemon = Effect.fnUntraced(function* (
        info: Info,
        invocation: ShellCreateBefore,
        args: string[],
        toolCall: ToolCall | undefined,
      ) {
        const stored: Stored = {
          id: info.id,
          command: info.command,
          shell: info.shell,
          location: {
            directory: location.directory,
            ...(location.workspaceID !== undefined ? { workspaceID: location.workspaceID } : {}),
          },
          metadata: info.metadata,
          ...(toolCall ? { toolCall } : {}),
          ...(invocation.timeout > 0 ? { timeoutDeadline: info.time.started + invocation.timeout } : {}),
        }
        const created = yield* pty.createPipe({
          program: invocation.shell,
          args,
          cwd: invocation.cwd,
          // The daemon replaces the environment, so variables removed by hooks stay removed, like the spawner.
          env: Object.fromEntries(
            Object.entries(invocation.env).filter((entry): entry is [string, string] => entry[1] !== undefined),
          ),
          groupID: location.project.id,
          outputPath: info.file,
          metadata: stored,
        })
        const daemon: Daemon = { id: created.id, stored }
        const command = daemonCommand(
          produce(info, (draft) => {
            if (created.pid !== undefined) draft.pid = created.pid
            // The daemon's clock, so the command reports the same start after a restart.
            draft.time.started = created.startedAt
          }),
          daemon,
        )
        commands.set(info.id, command)
        // Timed from now: starting the daemon may have taken a while.
        attach(command, daemon, invocation.timeout > 0 ? invocation.timeout : undefined)
        yield* bus.publish(Shell.Event.Created, { info: command.info })
        return command.info
      })

      // Takes back this Location's daemon commands, left by a previous server or an evicted Location.
      // Two Locations can share a project's output directory, so match the Location itself.
      const recover = Effect.fnUntraced(function* () {
        const processes = yield* pty
          .listPipes()
          .pipe(
            Effect.catch((error) =>
              Effect.logWarning("failed to list shell commands to recover", { error: error.message }).pipe(
                Effect.as([]),
              ),
            ),
          )
        const finished: { id: Shell.ID; exitedAt: number }[] = []
        for (const process of processes) {
          const stored = Option.getOrUndefined(decodeStored(process.metadata))
          if (
            !stored ||
            stored.location.directory !== location.directory ||
            stored.location.workspaceID !== location.workspaceID ||
            path.dirname(process.outputPath) !== outputDir ||
            commands.has(stored.id)
          )
            continue
          const running = process.lifecycle.status === "running"
          const exited = process.lifecycle.status === "exited" ? process.lifecycle : undefined
          const status = running ? "running" : (stored.stopReason ?? (exited ? "exited" : "killed"))
          const info: Info = {
            id: stored.id,
            status,
            command: stored.command,
            cwd: process.cwd,
            shell: stored.shell,
            file: process.outputPath,
            ...(process.pid !== undefined ? { pid: process.pid } : {}),
            ...(status === "exited" && exited?.exitCode !== undefined ? { exit: exited.exitCode } : {}),
            ...(status === "exited" && exited?.signal !== undefined ? { signal: exited.signal } : {}),
            metadata: stored.metadata,
            time: {
              started: process.startedAt,
              ...(running ? {} : { completed: process.exitedAt ?? process.startedAt }),
            },
          }
          const daemon: Daemon = {
            id: process.id,
            stored,
            ...(running ? {} : { outputLines: process.outputLines, outputError: process.outputError }),
          }
          const command = daemonCommand(info, daemon)
          commands.set(stored.id, command)
          if (running) {
            // A command moved to the background at shutdown has no timeout; an expired deadline fires at once.
            const deadline = stored.backgroundedAtShutdown ? undefined : stored.timeoutDeadline
            attach(command, daemon, deadline === undefined ? undefined : Math.max(0, deadline - Date.now()))
            continue
          }
          yield* Deferred.succeed(command.done, info)
          finished.push({ id: stored.id, exitedAt: info.time.completed ?? 0 })
        }
        exitOrder.push(...finished.toSorted((a, b) => a.exitedAt - b.exitedAt).map((item) => item.id))
        yield* evict()
      })

      const create = Effect.fn("Shell.create")(function* <E = never, R = never>(
        input: CreateInput,
        before?: (input: ShellCreateBefore) => Effect.Effect<void, E, R>,
      ) {
        const sessionID = input.metadata?.sessionID
        const baseEnv =
          location.workspaceID !== undefined
            ? undefined
            : ((Schema.is(SessionSchema.ID)(sessionID) ? yield* environments.get(sessionID) : undefined) ?? process.env)
        const invocation: ShellCreateBefore = {
          command: input.command,
          cwd: input.cwd ?? location.directory,
          timeout: input.timeout ?? 0,
          shell: input.shell ?? (yield* shell.resolve({ priority: "config" })),
          env: {
            ...baseEnv,
            TERM: "xterm-256color",
            OPENCODE_TERMINAL: "1",
          },
        }
        yield* hooks.trigger("shell", "create.before", invocation)
        if (before) yield* before(invocation)
        // Absolute for local commands, so the command reports the same cwd after a restart, wherever it runs.
        if (location.workspaceID === undefined) invocation.cwd = path.resolve(location.directory, invocation.cwd)

        const id = Shell.ID.ascending()
        const args = ShellSelect.args(invocation.shell, invocation.command)
        const file = path.join(outputDir, `${id}.out`)

        const info: Info = {
          id,
          status: "running",
          command: invocation.command,
          cwd: invocation.cwd,
          shell: invocation.shell,
          file,
          metadata: input.metadata ?? {},
          time: { started: Date.now() },
        }

        if (daemonEnabled) {
          const created = yield* createInDaemon(info, invocation, args, input.toolCall).pipe(
            Effect.map(Option.some),
            Effect.catchTags({
              "PersistentPty.UnavailableError": (error) =>
                Effect.logWarning("process daemon unavailable; spawning shell command instead", {
                  error: error.message,
                }).pipe(Effect.as(Option.none<Info>())),
              // The daemon may have run it: never run it again here.
              "PersistentPty.RequestError": (cause) =>
                Effect.fail(new AppProcess.AppProcessError({ command: invocation.command, cause })),
            }),
          )
          if (Option.isSome(created)) return created.value
        }

        // Spawn through the Environment and stream combined output to the file. The handle is scope-bound, so
        // the managing fiber keeps its scope open until the command terminates (it awaits `done` at the
        // end). `create` returns once `ready` resolves with the registered command.
        const ready = Deferred.makeUnsafe<Active, AppProcess.AppProcessError>()
        runFork(
          Effect.scoped(
            Effect.gen(function* () {
              const handle = yield* environment.spawner
                .spawn(
                  ChildProcess.make(invocation.shell, args, {
                    cwd: invocation.cwd,
                    env: invocation.env,
                    stdin: "ignore",
                    detached: process.platform !== "win32",
                    forceKillAfter: STOP_GRACE,
                  }),
                )
                .pipe(
                  Effect.mapError((cause) => new AppProcess.AppProcessError({ command: invocation.command, cause })),
                )
              const command: Active = {
                info: produce(info, (draft) => {
                  draft.pid = handle.pid
                }),
                file,
                size: 0,
                newlines: 0,
                done: Deferred.makeUnsafe<Info, NotFoundError>(),
                detachable: false,
              }
              commands.set(id, command)

              const stream = createWriteStream(file)
              const outputDone = Latch.makeUnsafe()
              const pump = handle.all.pipe(
                Stream.runForEach((chunk: Uint8Array) =>
                  Effect.sync(() => {
                    stream.write(chunk)
                    command.size += chunk.length
                    // Count while streaming so truncation notices never rescan the output file.
                    for (let index = chunk.indexOf(10); index !== -1; index = chunk.indexOf(10, index + 1))
                      command.newlines++
                  }),
                ),
              )
              runFork(
                Effect.gen(function* () {
                  yield* pump.pipe(Effect.catch(() => Effect.void))
                  yield* Effect.promise(
                    () =>
                      new Promise<void>((resolve) => {
                        stream.end(() => resolve())
                      }),
                  )
                  yield* outputDone.open
                }),
              )
              yield* Effect.promise(
                () =>
                  new Promise<void>((resolve) => {
                    stream.once("open", () => resolve())
                    stream.once("error", () => resolve())
                  }),
              )

              // The process exit and the timeout race to record how the command ended; the first wins.
              const ended = Deferred.makeUnsafe<Ended>()
              const end = (outcome: Omit<Ended, "completed">) =>
                Effect.suspend(() => Deferred.succeed(ended, { ...outcome, completed: Date.now() }))

              // A recorded stop must always kill. The kill runs detached, so interrupting the caller (a timer
              // being retimed, removed or torn down) neither cancels it nor waits for the process to die.
              const stop = (reason: StopReason) =>
                Effect.gen(function* () {
                  if (!(yield* end({ status: reason }))) return
                  runFork(handle.kill({ forceKillAfter: STOP_GRACE }).pipe(Effect.catch(() => Effect.void)))
                }).pipe(Effect.uninterruptible)
              command.stop = stop

              command.timeout = (duration) =>
                Effect.gen(function* () {
                  if (Deferred.isDoneUnsafe(ended)) return
                  if (command.timeoutFiber) yield* Fiber.interrupt(command.timeoutFiber)
                  command.timeoutFiber = undefined
                  if (duration === 0) return
                  command.timeoutFiber = runFork(
                    Effect.sleep(Duration.millis(duration)).pipe(Effect.andThen(stop("timeout"))),
                  )
                })

              yield* command.timeout(invocation.timeout)

              // The process exits even after a timeout kill, so this fiber always publishes the outcome.
              runFork(
                Effect.gen(function* () {
                  yield* handle.exitCode.pipe(
                    Effect.flatMap((code) => end({ status: "exited", exit: code })),
                    Effect.catch((error) =>
                      end({
                        status: "exited",
                        signal:
                          error.cause instanceof CrossSpawnSpawner.KilledBySignal ? error.cause.signal : undefined,
                      }),
                    ),
                  )
                  const outcome = yield* Deferred.await(ended)
                  // Report the terminal status only once captured output is complete, so a reader that
                  // sees it never reads a partial file.
                  yield* outputDone.await
                  yield* finish(command, outcome)
                }),
              )

              yield* bus.publish(Shell.Event.Created, { info })
              yield* Deferred.succeed(ready, command)
              // Hold the handle's scope open until the command terminates; closing it earlier would
              // release (kill) the process before its exit is observed.
              yield* Deferred.await(command.done).pipe(Effect.catch(() => Effect.void))
            }),
          ).pipe(Effect.catchTag("AppProcessError", (error) => Deferred.fail(ready, error))),
        )

        const command = yield* Deferred.await(ready)
        return command.info
      })

      // Taken back before the service is returned, so session restart recovery sees them.
      if (daemonEnabled) yield* recover()

      return Service.of({
        create,
        list,
        get,
        wait,
        result,
        timeout,
        stop,
        detachable,
        backgroundAtShutdown,
        byToolCall,
        output,
        remove,
      })
    }),
  )

export const node = makeLocationNode({
  service: Service,
  layer: layer(),
  deps: [
    Bus.node,
    Location.node,
    Global.node,
    ShellSelect.node,
    Environment.node,
    PluginHooks.node,
    SessionEnvironment.node,
    Config.node,
    PersistentPty.node,
    LocationLifecycle.node,
    Detaching.node,
    cleanupNode,
  ],
})
