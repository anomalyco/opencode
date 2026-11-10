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
const SPAN_COMMAND_LIMIT = 200
const STOP_GRACE = Duration.seconds(3)
const LOST = "Command was killed: the process daemon stopped"
// Bounds the reads a result needs when the daemon did not report the line count, so stopping a call stays quick.
const COUNT_NEWLINES_LIMIT = 16 * 1024 * 1024
const LINE_START_SCAN_LIMIT = 1024 * 1024

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
  // A call waits on the command. A server that takes the command over moves it to the background, which clears
  // its timeout, so its deadline is not kept for a restart.
  waited?: boolean
}

// What a server needs to take a daemon-run command back after a restart, kept in the daemon's metadata.
const Stored = Schema.Struct({
  id: Shell.ID,
  command: Schema.String,
  shell: Schema.String,
  location: Schema.Struct({ directory: Schema.String, workspaceID: Schema.optionalKey(Schema.String) }),
  metadata: Shell.Metadata,
  toolCall: Schema.optional(ToolCall),
  timeoutDeadline: Schema.optional(Schema.Number),
  stopReason: Schema.optional(Schema.Literals(["timeout", "killed"])),
})
type Stored = typeof Stored.Type
const decodeStored = Schema.decodeUnknownOption(Stored)

// A command this server spawned itself. It dies with its Location.
type Spawned = {
  kind: "spawned"
  // Immutable snapshot; lifecycle updates replace it via immer `produce`.
  info: Info
  size: number
  newlines: number
  // Byte offsets where the last two lines start, so a truncation notice can size a cut-off line.
  lineStarts: [number, number]
  // Resolves with the terminal Info once the command exits, times out, or is killed. A wait
  // started after termination resolves immediately from the already-completed deferred.
  done: Deferred.Deferred<Info, NotFoundError>
  timeoutFiber?: Fiber.Fiber<void>
  timeout?: (duration: number) => Effect.Effect<void>
  stop?: (reason: StopReason) => Effect.Effect<void>
}

// A command the process daemon runs. The daemon writes and counts its output file. It belongs to the server, not
// to the Location that started it, so a Location closing or reloading never stops or forgets it.
type Run = {
  kind: "daemon"
  info: Info
  process: number
  toolCall?: ToolCall
  // When a restart should stop it. Unset while a call waits on it: that call's timeout dies with this server.
  timeoutDeadline?: number
  stopReason?: StopReason
  // From the exit: newlines in the file, and why the daemon stopped writing it early.
  outputLines?: number
  outputError?: string
  // Why it was killed without a signal of its own.
  killed?: string
  done: Deferred.Deferred<Info, NotFoundError>
  timeoutFiber?: Fiber.Fiber<void>
  stopping?: Fiber.Fiber<void>
  wait?: Fiber.Fiber<void>
}

type Command = Spawned | Run

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
 * Local commands run in the process daemon when it is available (`Daemon`), so they outlive a planned server
 * restart: the next server takes them back. Remote workspaces, Windows and an unavailable daemon keep spawning
 * them from the server.
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
  // With `wait`, stops waiting for the exit after that long and returns the output so far, still running.
  readonly result: (
    started: Shell.Info,
    options?: { readonly wait?: Duration.Input },
  ) => Effect.Effect<ShellResult.Result>
  // Replaces the running command's timeout from now; zero clears it. Ignored once the command has
  // ended or timed out, even while its process is still being killed or its output captured.
  readonly timeout: (id: Shell.ID, duration: number) => Effect.Effect<Shell.Info, NotFoundError>
  // Stops a running command gracefully (SIGTERM, then SIGKILL after 3 s) without forgetting it: it ends
  // with the given status and stays observable, file included, until retention evicts it. Returns at
  // once; `wait` observes the exit. Ignored once the command has ended or is already stopping.
  readonly stop: (id: Shell.ID, reason: StopReason) => Effect.Effect<Shell.Info, NotFoundError>
  // The daemon command a tool call started, while it is known here (including one taken back after a restart).
  readonly byToolCall: (call: ToolCall) => Effect.Effect<Shell.Info | undefined>
  readonly output: (id: Shell.ID, input?: Shell.OutputInput) => Effect.Effect<Shell.Output, NotFoundError>
  readonly remove: (id: Shell.ID) => Effect.Effect<void, NotFoundError>
  /** Runs `effect` until it ends or the server stops, outliving this Location (e.g. a job's completion notice). */
  readonly watch: DaemonInterface["watch"]
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
  // Never starts the daemon. A command it still runs keeps its file; a finished one whose file expired is forgotten
  // below.
  const processes = new Map(
    (yield* pty.listPipes().pipe(Effect.orElseSucceed(() => []))).map((process) => [process.outputPath, process]),
  )
  yield* FileRetention.cleanup(
    fs,
    files.flat().filter((file) => processes.get(file)?.lifecycle.status !== "running"),
    RETENTION,
  )
  // Finished processes whose file is gone, or that ended long ago, are of no use to any Location: forget them.
  const cutoff = Date.now() - Duration.toMillis(RETENTION)
  yield* Effect.forEach(
    processes.values(),
    (process) =>
      Effect.gen(function* () {
        if (process.lifecycle.status === "running") return
        const stale = (process.exitedAt ?? process.startedAt) < cutoff
        if (!stale && (yield* fs.exists(process.outputPath).pipe(Effect.orElseSucceed(() => true)))) return
        yield* pty.terminatePipe(process.id).pipe(Effect.ignore)
      }),
    { concurrency: 8, discard: true },
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

/** One Location's daemon commands, as `Daemon.at` hands them to its `Shell`. */
interface Runs {
  readonly get: (id: Shell.ID) => Run | undefined
  readonly list: () => Run[]
  /** Fails with `UnavailableError` only when the daemon could not be reached or started: spawning instead is safe. */
  readonly create: (input: {
    readonly info: Info
    readonly args: readonly string[]
    readonly env: Readonly<Record<string, string>>
    readonly timeout: number
    readonly toolCall: ToolCall | undefined
    readonly waited: boolean
  }) => Effect.Effect<Info, PersistentPty.UnavailableError | PersistentPty.RequestError>
  readonly timeout: (run: Run, duration: number) => Effect.Effect<void>
  readonly stop: (run: Run, reason: StopReason) => Effect.Effect<void>
  readonly remove: (id: Shell.ID) => Effect.Effect<void>
}

export interface DaemonInterface {
  /** A Location's daemon commands. The first call for a Location in this server takes its commands back from the daemon. */
  readonly at: (location: Location.Interface) => Effect.Effect<Runs>
  /** Runs `effect` until it ends or the server stops, outliving the caller's Location (e.g. a job's completion notice). */
  readonly watch: (effect: Effect.Effect<void, unknown>) => Effect.Effect<void>
}

/** The process daemon's shell commands, owned by the server and grouped by Location. */
export class Daemon extends Context.Service<Daemon, DaemonInterface>()("@opencode/Shell/Daemon") {}

const daemonLayer = Layer.effect(
  Daemon,
  Effect.gen(function* () {
    const bus = yield* Bus.Service
    const pty = yield* PersistentPty.Service
    const scope = yield* Effect.scope
    const context = yield* Effect.context()
    const global = yield* Global.Service
    const { unlink } = yield* Effect.promise(() => import("fs/promises"))
    // Keyed by canonical Location. `recovered` resolves once the Location's commands were taken back.
    const places = new Map<string, { runs: Runs; recovered: Deferred.Deferred<void> }>()
    // Fibers run with the server's context in its scope, so a Location closing never interrupts them. On shutdown
    // they end without settling anything: the commands keep running for the next server, and the jobs waiting on
    // them are left to the job registry, which keeps their rows for it.
    const fork = (effect: Effect.Effect<void>) =>
      effect.pipe(Effect.forkIn(scope, { startImmediately: true }), Effect.setContext(context))

    const place = (location: Location.Interface) => {
      const runs = new Map<Shell.ID, Run>()
      const exitOrder: Shell.ID[] = []
      const ref = Location.Ref.make({ directory: location.directory, workspaceID: location.workspaceID })
      const outputDir = path.join(global.data, DIRECTORY, location.project.id)

      const persisted = (run: Run): Stored => ({
        id: run.info.id,
        command: run.info.command,
        shell: run.info.shell,
        location: {
          directory: location.directory,
          ...(location.workspaceID !== undefined ? { workspaceID: location.workspaceID } : {}),
        },
        metadata: run.info.metadata,
        toolCall: run.toolCall,
        timeoutDeadline: run.timeoutDeadline,
        stopReason: run.stopReason,
      })

      // Records the command's latest timeout and stop reason in the daemon, so a restart sees them.
      const store = (run: Run) =>
        pty
          .setPipeMetadata(run.process, persisted(run))
          .pipe(
            Effect.catch((error) =>
              Effect.logWarning("failed to update shell command metadata", { id: run.info.id, error: error.message }),
            ),
          )

      const remove = Effect.fnUntraced(function* (id: Shell.ID) {
        const run = runs.get(id)
        const index = exitOrder.indexOf(id)
        if (index !== -1) exitOrder.splice(index, 1)
        if (!run) return
        runs.delete(id)
        if (run.timeoutFiber) yield* Fiber.interrupt(run.timeoutFiber)
        if (run.stopping) yield* Fiber.interrupt(run.stopping)
        // Stop waiting first, so forgetting the process is not mistaken for losing it.
        if (run.wait) yield* Fiber.interrupt(run.wait)
        // Forget the process before deleting its file. This also kills what is left of its group, even after a
        // successful exit, which a spawned command would leave running: the daemon cannot forget a process otherwise.
        yield* pty.terminatePipe(run.process).pipe(Effect.ignore)
        yield* Effect.promise(() => unlink(run.info.file).catch(() => {}))
        yield* Deferred.fail(run.done, new NotFoundError({ id }))
        // Every shell reports exactly one exit; removing a running one ends it as killed.
        if (run.info.status === "running")
          yield* bus.publish(Shell.Event.Exited, { id, status: "killed" }, { location: ref })
        yield* bus.publish(Shell.Event.Deleted, { id }, { location: ref })
      })

      const evict = Effect.fnUntraced(function* () {
        while (exitOrder.length > EXITED_LIMIT) {
          const oldest = exitOrder[0]
          if (!oldest) break
          yield* remove(oldest)
        }
      })

      const finish = Effect.fnUntraced(function* (run: Run, outcome: Ended) {
        const id = run.info.id
        // A removed command already failed its waiters and published its exit and deletion.
        if (runs.get(id) !== run) return
        run.info = produce(run.info, (draft) => {
          draft.status = outcome.status
          if (outcome.exit !== undefined) draft.exit = outcome.exit
          if (outcome.signal !== undefined) draft.signal = outcome.signal
          draft.time.completed = outcome.completed
        })
        if (run.timeoutFiber) yield* Fiber.interrupt(run.timeoutFiber)
        run.timeoutFiber = undefined
        // Resolve waiters before retention eviction, so an evicted command still reports its
        // terminal Info rather than the removal NotFoundError.
        yield* Deferred.succeed(run.done, run.info)
        yield* bus.publish(
          Shell.Event.Exited,
          { id, ...(outcome.exit !== undefined ? { exit: outcome.exit } : {}), status: outcome.status },
          { location: ref },
        )
        exitOrder.push(id)
        yield* evict()
      })

      // Graceful, like spawned commands: SIGTERM, then SIGKILL if it has not exited 3 s later. It runs on its own,
      // so interrupting the caller (a timer being retimed, removed or torn down) never cancels a recorded stop.
      const stop = (run: Run, reason: StopReason) =>
        Effect.gen(function* () {
          if (run.stopReason !== undefined || run.info.status !== "running") return
          run.stopReason = reason
          run.timeoutDeadline = undefined
          run.stopping = yield* fork(
            Effect.gen(function* () {
              yield* store(run)
              yield* pty.signalPipe(run.process, "SIGTERM").pipe(Effect.ignore)
              const ended = yield* Deferred.await(run.done).pipe(Effect.timeoutOption(STOP_GRACE), Effect.exit)
              if (Exit.isSuccess(ended) && Option.isNone(ended.value))
                yield* pty.signalPipe(run.process, "SIGKILL").pipe(Effect.ignore)
            }),
          )
        })

      const arm = Effect.fnUntraced(function* (run: Run, duration: number) {
        run.timeoutFiber = yield* fork(
          Effect.sleep(Duration.millis(duration)).pipe(Effect.andThen(stop(run, "timeout"))),
        )
      })

      const timeout = Effect.fnUntraced(function* (run: Run, duration: number) {
        if (run.stopReason !== undefined || run.info.status !== "running") return
        if (run.timeoutFiber) yield* Fiber.interrupt(run.timeoutFiber)
        run.timeoutFiber = undefined
        run.timeoutDeadline = duration === 0 ? undefined : Date.now() + duration
        yield* store(run)
        if (duration !== 0) yield* arm(run, duration)
      })

      // Watches the exit, and the timeout (in ms from now, none if undefined).
      const attach = Effect.fnUntraced(function* (run: Run, duration: number | undefined) {
        run.wait = yield* fork(
          pty.waitPipe(run.process).pipe(
            Effect.map((exit): Ended => {
              run.outputLines = exit.outputLines
              run.outputError = exit.outputError
              // A stopped command reports its reason, and how the stopped process ended, as spawned ones do.
              return {
                status: run.stopReason ?? "exited",
                ...(exit.exitCode !== undefined ? { exit: exit.exitCode } : {}),
                ...(exit.signal !== undefined ? { signal: exit.signal } : {}),
                completed: exit.exitedAt,
              }
            }),
            // The daemon went away (and its processes with it), or forgot the process: it was killed.
            Effect.catch((error) =>
              Effect.logWarning("lost a shell command's process", { id: run.info.id, error: error.message }).pipe(
                Effect.andThen(
                  Effect.sync((): Ended => {
                    run.killed = LOST
                    return { status: "killed", completed: Date.now() }
                  }),
                ),
              ),
            ),
            // Like spawned commands: what a failed command left running in its group is stopped with it, while a
            // successful one may leave background processes (`cmd &`) behind.
            Effect.tap((outcome) =>
              outcome.status === "exited" && outcome.exit !== undefined && outcome.exit !== 0
                ? pty.signalPipe(run.process, "SIGTERM").pipe(Effect.ignore)
                : Effect.void,
            ),
            Effect.flatMap((outcome) => finish(run, outcome)),
          ),
        )
        // A stop interrupted by a restart lost its grace period: kill now.
        if (run.stopReason !== undefined) {
          run.stopping = yield* fork(pty.signalPipe(run.process, "SIGKILL").pipe(Effect.ignore))
          return
        }
        if (duration === undefined) return
        if (duration > 0) return yield* arm(run, duration)
        yield* stop(run, "timeout")
      })

      const create: Runs["create"] = Effect.fnUntraced(function* (input) {
        const run: Run = {
          kind: "daemon",
          info: input.info,
          process: 0,
          toolCall: input.toolCall,
          timeoutDeadline: !input.waited && input.timeout > 0 ? input.info.time.started + input.timeout : undefined,
          done: Deferred.makeUnsafe<Info, NotFoundError>(),
        }
        const created = yield* pty.createPipe({
          program: input.info.shell,
          args: input.args,
          cwd: input.info.cwd,
          env: input.env,
          groupID: location.project.id,
          outputPath: input.info.file,
          metadata: persisted(run),
        })
        run.process = created.id
        run.info = produce(input.info, (draft) => {
          if (created.pid !== undefined) draft.pid = created.pid
          // The daemon's clock, so the command reports the same start wherever it is read.
          draft.time.started = created.startedAt
        })
        runs.set(run.info.id, run)
        // Timed from now: starting the daemon may have taken a while.
        yield* attach(run, input.timeout > 0 ? input.timeout : undefined)
        yield* bus.publish(Shell.Event.Created, { info: run.info }, { location: ref })
        return run.info
      })

      // Takes back this Location's commands, left by a previous server. Two Locations can share a project's output
      // directory, so match the Location itself.
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
        const finished: Run[] = []
        for (const process of processes) {
          const stored = Option.getOrUndefined(decodeStored(process.metadata))
          if (
            !stored ||
            stored.location.directory !== location.directory ||
            stored.location.workspaceID !== location.workspaceID ||
            path.dirname(process.outputPath) !== outputDir ||
            runs.has(stored.id)
          )
            continue
          const running = process.lifecycle.status === "running"
          const exited = process.lifecycle.status === "exited" ? process.lifecycle : undefined
          const status = running ? "running" : (stored.stopReason ?? (exited ? "exited" : "killed"))
          const run: Run = {
            kind: "daemon",
            info: {
              id: stored.id,
              status,
              command: stored.command,
              cwd: process.cwd,
              shell: stored.shell,
              file: process.outputPath,
              ...(process.pid !== undefined ? { pid: process.pid } : {}),
              ...(exited?.exitCode !== undefined ? { exit: exited.exitCode } : {}),
              ...(exited?.signal !== undefined ? { signal: exited.signal } : {}),
              metadata: stored.metadata,
              time: {
                started: process.startedAt,
                ...(running ? {} : { completed: process.exitedAt ?? process.startedAt }),
              },
            },
            process: process.id,
            toolCall: stored.toolCall,
            timeoutDeadline: stored.timeoutDeadline,
            stopReason: stored.stopReason,
            ...(running ? {} : { outputLines: process.outputLines, outputError: process.outputError }),
            ...(process.lifecycle.status === "failed" && !stored.stopReason
              ? { killed: `Command was killed: ${process.lifecycle.message}` }
              : {}),
            done: Deferred.makeUnsafe<Info, NotFoundError>(),
          }
          runs.set(stored.id, run)
          if (running) {
            // A deadline that passed while no server ran fires at once.
            const deadline = stored.timeoutDeadline
            yield* attach(run, deadline === undefined ? undefined : Math.max(0, deadline - Date.now()))
            continue
          }
          yield* Deferred.succeed(run.done, run.info)
          finished.push(run)
        }
        exitOrder.push(
          ...finished
            .toSorted((a, b) => (a.info.time.completed ?? 0) - (b.info.time.completed ?? 0))
            .map((run) => run.info.id),
        )
        yield* evict()
      })

      const handle: Runs = {
        get: (id) => runs.get(id),
        list: () => Array.from(runs.values()),
        create,
        timeout,
        stop,
        remove,
      }
      return { runs: handle, recover }
    }

    const at = Effect.fnUntraced(function* (location: Location.Interface) {
      const key = `${location.directory}\0${location.workspaceID ?? ""}`
      const existing = places.get(key)
      if (existing) {
        yield* Deferred.await(existing.recovered)
        return existing.runs
      }
      const placed = place(location)
      const entry = { runs: placed.runs, recovered: Deferred.makeUnsafe<void>() }
      places.set(key, entry)
      // Uninterruptible: the entry is shared, so a caller's interrupt must not leave it half recovered.
      yield* placed
        .recover()
        .pipe(Effect.ensuring(Deferred.succeed(entry.recovered, undefined)), Effect.uninterruptible)
      return placed.runs
    })

    return Daemon.of({
      at,
      watch: (effect) =>
        fork(effect.pipe(Effect.catch((error) => Effect.logError("shell watcher failed", { error })))).pipe(
          Effect.asVoid,
        ),
    })
  }),
)

export const daemonNode = makeGlobalNode({
  service: Daemon,
  layer: daemonLayer,
  deps: [Bus.node, Global.node, PersistentPty.node],
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
      const daemon = yield* Daemon
      const context = yield* Effect.context()
      const runFork = Effect.runForkWith(context)
      // Commands this server spawned for the Location; daemon commands live in `runs`, owned by the server.
      const commands = new Map<Shell.ID, Spawned>()
      const exitOrder: Shell.ID[] = []
      // Remote workspaces and Windows keep spawning commands from the server. Taken back before the service is
      // returned, so session restart recovery sees them.
      const runs =
        location.workspaceID === undefined && process.platform !== "win32" && PersistentPty.available
          ? yield* daemon.at(location)
          : undefined

      const outputDir = path.join(global.data, DIRECTORY, location.project.id)
      const { mkdir, unlink, stat } = yield* Effect.promise(() => import("fs/promises"))
      const { createWriteStream, createReadStream } = yield* Effect.promise(() => import("fs"))
      yield* Effect.promise(() => mkdir(outputDir, { recursive: true }))

      yield* Effect.addFinalizer(() =>
        Effect.gen(function* () {
          for (const command of commands.values()) {
            if (command.timeoutFiber) yield* Fiber.interrupt(command.timeoutFiber)
            // Teardown interrupts pending commands; it is not a terminal command failure. Daemon commands are left
            // to the server.
            yield* Deferred.interrupt(command.done)
          }
          commands.clear()
          exitOrder.length = 0
        }),
      )

      const require = Effect.fnUntraced(function* (id: Shell.ID) {
        const command: Command | undefined = commands.get(id) ?? runs?.get(id)
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
        // Unblock any wait still pending when the command is removed before it terminated.
        yield* Deferred.fail(command.done, new NotFoundError({ id }))
        yield* Effect.promise(() => unlink(command.info.file).catch(() => {}))
        // Every shell reports exactly one exit; removing a running one ends it as killed.
        if (command.info.status === "running") yield* bus.publish(Shell.Event.Exited, { id, status: "killed" })
        yield* bus.publish(Shell.Event.Deleted, { id })
      })

      const remove = Effect.fn("Shell.remove")(function* (id: Shell.ID) {
        const command = yield* require(id)
        yield* annotate(command.info)
        if (command.kind === "daemon") return yield* runs?.remove(id) ?? Effect.void
        yield* removeCommand(id)
      })

      const list = Effect.fn("Shell.list")(function* () {
        return [...commands.values(), ...(runs?.list() ?? [])]
          .filter((command) => command.info.status === "running")
          .map((command) => command.info)
      })

      const get = Effect.fn("Shell.get")(function* (id: Shell.ID) {
        const { info } = yield* require(id)
        yield* annotate(info)
        return info
      })

      const wait = Effect.fn("Shell.wait")(function* (id: Shell.ID) {
        const command = yield* require(id)
        yield* annotate(command.info)
        const info = yield* Deferred.await(command.done)
        yield* annotate(info)
        return info
      })

      const timeout = Effect.fn("Shell.timeout")(function* (id: Shell.ID, duration: number) {
        const command = yield* require(id)
        yield* annotate(command.info)
        if (command.kind === "daemon") yield* runs?.timeout(command, duration) ?? Effect.void
        if (command.kind === "spawned" && command.info.status === "running" && command.timeout)
          yield* command.timeout(duration)
        return command.info
      })

      const stop = Effect.fn("Shell.stop")(function* (id: Shell.ID, reason: StopReason) {
        const command = yield* require(id)
        yield* annotate(command.info)
        if (command.kind === "daemon") yield* runs?.stop(command, reason) ?? Effect.void
        if (command.kind === "spawned" && command.info.status === "running" && command.stop) yield* command.stop(reason)
        return command.info
      })

      const byToolCall = Effect.fn("Shell.byToolCall")(function* (call: ToolCall) {
        return runs
          ?.list()
          .find(
            (run) =>
              run.toolCall?.sessionID === call.sessionID &&
              run.toolCall.assistantMessageID === call.assistantMessageID &&
              run.toolCall.callID === call.callID,
          )?.info
      })

      const readRange = (file: string, start: number, length: number) =>
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
                  stream.on("error", () => resolve(buffer.subarray(0, 0)))
                }),
            )

      // A daemon command's file is the only record of its output, so its size is the file's; a missing file is empty.
      const sizeOf = (command: Command) =>
        command.kind === "spawned"
          ? Effect.succeed(command.size)
          : Effect.promise(() =>
              stat(command.info.file).then(
                (info) => info.size,
                () => 0,
              ),
            )

      const output = Effect.fnUntraced(function* (id: Shell.ID, input?: Shell.OutputInput) {
        const command = yield* require(id)
        const cursor = input?.cursor ?? 0
        const limit = input?.limit ?? 65536
        const size = yield* sizeOf(command)
        if (cursor >= size) return { output: "", cursor: size, size, truncated: false }
        const start = Math.max(0, cursor)
        const bytes = yield* readRange(command.info.file, start, Math.min(limit, size - start))
        return {
          output: bytes.toString("utf8"),
          cursor: start + bytes.length,
          size,
          truncated: false,
        }
      })

      // Only for a command whose exit report is missing (still running, or lost with the daemon); the daemon counts
      // newlines otherwise. Gives up on large files, whose line numbers then go unreported, to keep a result quick.
      const countNewlines = (file: string, size: number) =>
        Effect.promise(
          () =>
            new Promise<number | undefined>((resolve) => {
              if (size === 0) return resolve(0)
              if (size > COUNT_NEWLINES_LIMIT) return resolve(undefined)
              let count = 0
              const stream = createReadStream(file, { end: size - 1 })
              stream.on("data", (chunk: string | Buffer) => {
                const bytes = Buffer.from(chunk)
                for (let index = bytes.indexOf(10); index !== -1; index = bytes.indexOf(10, index + 1)) count++
              })
              stream.on("end", () => resolve(count))
              stream.on("error", () => resolve(count))
            }),
        )

      // Where the last two lines of a daemon command's output start, found by reading back from the end. Only needed
      // to size a single cut-off line, which the spawner tracks as it writes. A start further back than the scan
      // limit is reported as unknown.
      const lineStartsOf = Effect.fnUntraced(function* (file: string, size: number) {
        const starts: number[] = []
        let end = size
        const floor = Math.max(0, size - LINE_START_SCAN_LIMIT)
        while (end > floor && starts.length < 2) {
          const from = Math.max(floor, end - 65536)
          const chunk = yield* readRange(file, from, end - from)
          for (let index = chunk.length - 1; index >= 0 && starts.length < 2; index--)
            if (chunk[index] === 10) starts.push(from + index + 1)
          end = from
        }
        const unknown = floor > 0 ? undefined : 0
        return [starts[1] ?? unknown, starts[0] ?? unknown] as [number | undefined, number | undefined]
      })

      const result = Effect.fn("Shell.result")(function* (
        started: Shell.Info,
        options?: { readonly wait?: Duration.Input },
      ) {
        yield* annotate(started)
        const ended = wait(started.id).pipe(Effect.map(Option.some))
        const info = yield* (
          options?.wait === undefined
            ? ended
            : ended.pipe(
                Effect.timeoutOrElse({ duration: options.wait, orElse: () => Effect.succeed(Option.none<Info>()) }),
              )
        ).pipe(
          Effect.flatMap((info) => (Option.isSome(info) ? Effect.succeed(info.value) : get(started.id))),
          Effect.catchTag("Shell.NotFoundError", () =>
            Effect.succeed({ ...started, status: "killed" as const, time: { ...started.time, completed: Date.now() } }),
          ),
        )
        yield* annotate(info)
        const capture = yield* Effect.gen(function* () {
          const limits = Config.latest(yield* config.entries(), "tool_output")
          const maxLines = limits?.max_lines ?? ToolOutput.MAX_LINES
          const maxBytes = limits?.max_bytes ?? ToolOutput.MAX_BYTES
          const command = yield* require(info.id)
          const size = yield* sizeOf(command)
          const start = Math.max(0, size - maxBytes)
          // Read the byte before the window too, to tell whether the window starts on a line boundary.
          const before = Math.max(0, start - 1)
          const window = yield* readRange(info.file, before, size - before)
          const page = window.subarray(charBoundary(window, start - before)).toString("utf8")
          const partial = start > 0 && window[0] !== 10
          const endsWithNewline = page.endsWith("\n")
          const lines = page.split("\n")
          if (endsWithNewline) lines.pop()
          const newlines =
            command.kind === "spawned"
              ? command.newlines
              : (command.outputLines ?? (yield* countNewlines(info.file, size)))
          const total = newlines === undefined ? undefined : newlines + (endsWithNewline ? 0 : 1)
          const suffix = `full output saved to ${info.file}]`
          // After a write error the daemon kept running the command, but its file stopped early.
          const stoppedEarly =
            command.kind === "daemon" && command.outputError
              ? `\n\n[output file ${info.file} stopped early: ${command.outputError}]`
              : ""
          const killed = command.kind === "daemon" && command.killed ? { killed: command.killed } : {}
          if (partial && lines.length === 1) {
            const lineStarts = command.kind === "spawned" ? command.lineStarts : yield* lineStartsOf(info.file, size)
            const lineStart = endsWithNewline ? lineStarts[0] : lineStarts[1]
            const end = size - (endsWithNewline ? 1 : 0)
            const lineSize =
              lineStart === undefined
                ? `over ${formatSize(Math.min(end, LINE_START_SCAN_LIMIT))}`
                : formatSize(end - lineStart)
            const shownSize = Buffer.byteLength(lines[0])
            const line = total === undefined ? "the last line" : `line ${total}`
            return {
              output: `${lines[0]}\n\n[showing the last ${formatSize(shownSize)} of ${line} (${lineSize}); ${suffix}${stoppedEarly}`,
              truncated: true,
              ...killed,
            }
          }
          if (start > 0 || lines.length > maxLines) {
            // A window that starts mid-line drops that partial line so the line numbers stay exact.
            const kept = lines.slice(-Math.min(maxLines, lines.length - (partial ? 1 : 0)))
            return {
              output:
                total === undefined
                  ? `${kept.join("\n")}\n\n[showing the last ${kept.length} lines; ${suffix}${stoppedEarly}`
                  : `${kept.join("\n")}\n\n[showing lines ${total - kept.length + 1}-${total} of ${total}; ${suffix}${stoppedEarly}`,
              truncated: true,
              ...killed,
            }
          }
          return { output: `${page || "(no output)"}${stoppedEarly}`, truncated: false, ...killed }
        }).pipe(Effect.catchTag("Shell.NotFoundError", () => Effect.succeed(undefined)))
        return { info, capture }
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
        // Absolute for local commands, so the command reports the same cwd wherever it runs.
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
        yield* annotate(info)

        if (runs) {
          const created = yield* runs
            .create({
              info,
              args,
              // The daemon replaces the environment, so variables removed by hooks stay removed, like the spawner.
              env: Object.fromEntries(
                Object.entries(invocation.env).filter((entry): entry is [string, string] => entry[1] !== undefined),
              ),
              timeout: invocation.timeout,
              toolCall: input.toolCall,
              waited: input.waited === true,
            })
            .pipe(
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
        const ready = Deferred.makeUnsafe<Spawned, AppProcess.AppProcessError>()
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
              const command: Spawned = {
                kind: "spawned",
                info: produce(info, (draft) => {
                  draft.pid = handle.pid
                }),
                size: 0,
                newlines: 0,
                lineStarts: [0, 0],
                done: Deferred.makeUnsafe<Info, NotFoundError>(),
              }
              commands.set(id, command)

              const stream = createWriteStream(file)
              const outputDone = Latch.makeUnsafe()
              const pump = handle.all.pipe(
                Stream.runForEach((chunk: Uint8Array) =>
                  Effect.sync(() => {
                    stream.write(chunk)
                    // Count while streaming so truncation notices never rescan the output file.
                    for (let index = chunk.indexOf(10); index !== -1; index = chunk.indexOf(10, index + 1)) {
                      command.newlines++
                      command.lineStarts[0] = command.lineStarts[1]
                      command.lineStarts[1] = command.size + index + 1
                    }
                    command.size += chunk.length
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
              command.stop = (reason) =>
                Effect.gen(function* () {
                  if (!(yield* end({ status: reason }))) return
                  runFork(handle.kill({ forceKillAfter: STOP_GRACE }).pipe(Effect.catch(() => Effect.void)))
                }).pipe(Effect.uninterruptible)

              command.timeout = (duration) =>
                Effect.gen(function* () {
                  if (Deferred.isDoneUnsafe(ended)) return
                  if (command.timeoutFiber) yield* Fiber.interrupt(command.timeoutFiber)
                  command.timeoutFiber = undefined
                  if (duration === 0) return
                  const stop = command.stop
                  if (!stop) return
                  command.timeoutFiber = runFork(
                    Effect.sleep(Duration.millis(duration)).pipe(Effect.andThen(stop("timeout"))),
                  )
                })

              yield* command.timeout(invocation.timeout)

              // The process exits even after a timeout kill, so this fiber always publishes the outcome.
              runFork(
                Effect.gen(function* () {
                  const exited = yield* handle.exitCode.pipe(
                    Effect.map((code) => ({ exit: code, signal: undefined })),
                    Effect.catch((error) =>
                      Effect.succeed({
                        exit: undefined,
                        signal:
                          error.cause instanceof CrossSpawnSpawner.KilledBySignal ? error.cause.signal : undefined,
                      }),
                    ),
                  )
                  yield* end({ status: "exited", ...exited })
                  // A stop keeps its status but still records how the killed process exited.
                  const outcome = { ...(yield* Deferred.await(ended)), ...exited }
                  // Report the terminal status only once captured output is complete, so a reader that
                  // sees it never reads a partial file.
                  yield* outputDone.await
                  // A removed command already failed its waiters and published its exit and deletion.
                  if (commands.get(id) !== command) return
                  command.info = produce(command.info, (draft) => {
                    draft.status = outcome.status
                    if (outcome.exit !== undefined) draft.exit = outcome.exit
                    if (outcome.signal !== undefined) draft.signal = outcome.signal
                    draft.time.completed = outcome.completed
                  })
                  // Resolve waiters before retention eviction, so an evicted command still reports its
                  // terminal Info rather than the removal NotFoundError.
                  yield* Deferred.succeed(command.done, command.info)
                  yield* bus.publish(Shell.Event.Exited, {
                    id,
                    ...(outcome.exit !== undefined ? { exit: outcome.exit } : {}),
                    status: outcome.status,
                  })
                  exitOrder.push(id)
                  while (exitOrder.length > EXITED_LIMIT) {
                    const oldest = exitOrder[0]
                    if (!oldest) break
                    yield* removeCommand(oldest)
                  }
                  // Keep exited history data-only.
                  const timeoutFiber = command.timeoutFiber
                  command.timeout = undefined
                  command.stop = undefined
                  command.timeoutFiber = undefined
                  if (timeoutFiber) yield* Fiber.interrupt(timeoutFiber)
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

      return Service.of({
        create,
        list,
        get,
        wait,
        result,
        timeout,
        stop,
        byToolCall,
        output,
        remove,
        watch: daemon.watch,
      })
    }),
  )

// Spans carry only the command text, truncated; never env, stdin or output. Shells outlive the turn that started
// them, so the session comes from the shell's own metadata rather than the caller's span annotations.
function annotate(info: Info) {
  const sessionID = info.metadata.sessionID
  return Effect.annotateCurrentSpan({
    "opencode.shell.id": info.id,
    "opencode.shell.command": spanCommand(info.command),
    ...(typeof sessionID === "string" ? { "session.id": sessionID } : {}),
    ...(info.metadata.background === true ? { "opencode.shell.background": true } : {}),
    ...(info.status === "running" ? {} : { "opencode.shell.status": info.status }),
    ...(info.exit === undefined ? {} : { "process.exit.code": info.exit }),
  })
}

// Strict OTLP JSON parsers reject a lone surrogate, which a cut through an emoji would leave.
function spanCommand(command: string) {
  if (command.length <= SPAN_COMMAND_LIMIT) return command.toWellFormed()
  return `${command.slice(0, SPAN_COMMAND_LIMIT).toWellFormed()}…`
}

// Moves past UTF-8 continuation bytes (at most 3) so a byte cut never splits a character.
function charBoundary(bytes: Buffer, offset: number) {
  const limit = Math.min(bytes.length, offset + 3)
  for (let index = offset; index < limit; index++) if ((bytes[index] & 0xc0) !== 0x80) return index
  return limit
}

function formatSize(bytes: number) {
  const kb = bytes / 1024
  return kb > 1024 ? `${(kb / 1024).toFixed(1)} MB` : `${Math.round(kb)} KB`
}

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
    daemonNode,
    cleanupNode,
  ],
})
