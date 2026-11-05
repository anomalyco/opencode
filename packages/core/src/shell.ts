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
const STOP_GRACE = Duration.seconds(3)
const LOST = "Command was killed: the process daemon stopped"

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
  // A call is waiting on it. A server that takes it over after a restart moves it to the background instead.
  foreground?: boolean
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
  foreground: Schema.optional(Schema.Boolean),
})
type Stored = typeof Stored.Type
const decodeStored = Schema.decodeUnknownOption(Stored)

// A command the server spawned itself. It dies with its Location.
type Spawned = {
  kind: "spawned"
  // Immutable snapshot; lifecycle updates replace it via immer `produce`.
  info: Info
  // Bytes and newlines written so far.
  size: number
  newlines: number
  // Resolves with the terminal Info once the command exits, times out, or is killed. A wait
  // started after termination resolves immediately from the already-completed deferred.
  done: Deferred.Deferred<Info, NotFoundError>
  timeoutFiber?: Fiber.Fiber<void>
  timeout?: (duration: number) => Effect.Effect<void>
  stop?: (reason: StopReason) => Effect.Effect<void>
}

// A command the process daemon runs, which writes and counts its output file. It belongs to the server, not to
// the Location that started it, so it outlives a Location that closes or reloads.
type Run = {
  kind: "daemon"
  info: Info
  process: number
  toolCall?: ToolCall
  timeoutDeadline?: number
  stopReason?: StopReason
  // A call waits on it, until it moves to the background (its timeout cleared).
  foreground: boolean
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
    readonly foreground: boolean
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
    const global = yield* Global.Service
    const pty = yield* PersistentPty.Service
    const scope = yield* Effect.scope
    const context = yield* Effect.context()
    const { unlink } = yield* Effect.promise(() => import("fs/promises"))
    // Keyed by canonical Location. `recovered` resolves once the Location's commands were taken back.
    const places = new Map<string, { runs: Runs; recovered: Deferred.Deferred<void> }>()
    // Fibers run with the server's context in its scope, so a Location closing never interrupts them.
    const fork = (effect: Effect.Effect<void>) =>
      effect.pipe(Effect.forkIn(scope, { startImmediately: true }), Effect.setContext(context))

    // On shutdown the processes keep running for the next server: only stop waiting on them.
    yield* Effect.addFinalizer(() =>
      Effect.forEach(
        places.values(),
        (place) => Effect.forEach(place.runs.list(), (run) => Deferred.interrupt(run.done), { discard: true }),
        { discard: true },
      ),
    )

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
        foreground: run.foreground,
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

      const removeRun = Effect.fnUntraced(function* (id: Shell.ID) {
        const run = runs.get(id)
        const index = exitOrder.indexOf(id)
        if (index !== -1) exitOrder.splice(index, 1)
        if (!run) return
        runs.delete(id)
        if (run.timeoutFiber) yield* Fiber.interrupt(run.timeoutFiber)
        if (run.stopping) yield* Fiber.interrupt(run.stopping)
        // Stop waiting first, so forgetting the process is not mistaken for losing it.
        if (run.wait) yield* Fiber.interrupt(run.wait)
        // Forget the process before deleting its file.
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
          yield* removeRun(oldest)
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
        // Clearing the timeout is how a call moves its command to the background.
        if (duration === 0) run.foreground = false
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
              // A stopped command reports its reason, not the signal it was stopped with, as spawned ones do.
              if (run.stopReason) return { status: run.stopReason, completed: exit.exitedAt }
              return {
                status: "exited",
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
          foreground: input.foreground,
          timeoutDeadline: input.timeout > 0 ? input.info.time.started + input.timeout : undefined,
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
          // The daemon's clock, so the command reports the same start after a restart.
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
              ...(status === "exited" && exited?.exitCode !== undefined ? { exit: exited.exitCode } : {}),
              ...(status === "exited" && exited?.signal !== undefined ? { signal: exited.signal } : {}),
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
            foreground: stored.foreground === true,
            ...(running ? {} : { outputLines: process.outputLines, outputError: process.outputError }),
            ...(process.lifecycle.status === "failed" && !stored.stopReason
              ? { killed: `Command was killed: ${process.lifecycle.message}` }
              : {}),
            done: Deferred.makeUnsafe<Info, NotFoundError>(),
          }
          runs.set(stored.id, run)
          if (running) {
            // Its call died with the previous server, so taking it over moves it to the background, which clears
            // its timeout. Otherwise an expired deadline fires at once.
            const deadline = stored.foreground ? undefined : stored.timeoutDeadline
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
        remove: removeRun,
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
      yield* placed.recover().pipe(Effect.ensuring(Deferred.succeed(entry.recovered, undefined)))
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
      // Commands this server spawned for the Location. Daemon commands live in `runs`, owned by the server.
      const spawned = new Map<Shell.ID, Spawned>()
      const exitOrder: Shell.ID[] = []
      // Remote workspaces and Windows keep spawning commands from the server.
      const daemonEnabled =
        location.workspaceID === undefined && process.platform !== "win32" && PersistentPty.available
      // Taken back before the service is returned, so session restart recovery sees them.
      const runs = daemonEnabled ? yield* daemon.at(location) : undefined

      const outputDir = path.join(global.data, DIRECTORY, location.project.id)
      const { mkdir, unlink, open } = yield* Effect.promise(() => import("fs/promises"))
      const { createWriteStream, createReadStream } = yield* Effect.promise(() => import("fs"))
      yield* Effect.promise(() => mkdir(outputDir, { recursive: true }))

      // Spawned commands end with their Location; daemon commands are left to the server.
      yield* Effect.addFinalizer(() =>
        Effect.gen(function* () {
          for (const command of spawned.values()) {
            if (command.timeoutFiber) yield* Fiber.interrupt(command.timeoutFiber)
            // Teardown interrupts pending commands; it is not a terminal command failure. It never stops or
            // removes a command itself: a spawned process dies with its handle's scope once `done` settles.
            yield* Deferred.interrupt(command.done)
          }
          spawned.clear()
          exitOrder.length = 0
        }),
      )

      const find = (id: Shell.ID): Command | undefined => spawned.get(id) ?? runs?.get(id)

      const require = Effect.fnUntraced(function* (id: Shell.ID) {
        const command = find(id)
        if (!command) return yield* new NotFoundError({ id })
        return command
      })

      const removeSpawned = Effect.fnUntraced(function* (id: Shell.ID) {
        const command = spawned.get(id)
        const index = exitOrder.indexOf(id)
        if (index !== -1) exitOrder.splice(index, 1)
        if (!command) return
        spawned.delete(id)
        if (command.timeoutFiber) yield* Fiber.interrupt(command.timeoutFiber)
        // Unblock any wait still pending when the command is removed before it terminated.
        yield* Deferred.fail(command.done, new NotFoundError({ id }))
        yield* Effect.promise(() => unlink(command.info.file).catch(() => {}))
        // Every shell reports exactly one exit; removing a running one ends it as killed.
        if (command.info.status === "running") yield* bus.publish(Shell.Event.Exited, { id, status: "killed" })
        yield* bus.publish(Shell.Event.Deleted, { id })
      })

      // Records how a spawned command ended, once, unless it was removed meanwhile.
      const finish = Effect.fnUntraced(function* (command: Spawned, outcome: Ended) {
        const id = command.info.id
        if (spawned.get(id) !== command) return
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
          yield* removeSpawned(oldest)
        }
        // Keep exited history data-only.
        const timeoutFiber = command.timeoutFiber
        command.timeout = undefined
        command.stop = undefined
        command.timeoutFiber = undefined
        if (timeoutFiber) yield* Fiber.interrupt(timeoutFiber)
      })

      const remove = Effect.fn("Shell.remove")(function* (id: Shell.ID) {
        const command = yield* require(id)
        if (command.kind === "daemon") return yield* runs!.remove(id)
        yield* removeSpawned(id)
      })

      const list = Effect.fn("Shell.list")(function* () {
        return [...spawned.values(), ...(runs?.list() ?? [])]
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
        if (command.kind === "daemon") yield* runs!.timeout(command, duration)
        if (command.kind === "spawned" && command.info.status === "running" && command.timeout)
          yield* command.timeout(duration)
        return command.info
      })

      const stop = Effect.fn("Shell.stop")(function* (id: Shell.ID, reason: StopReason) {
        const command = yield* require(id)
        if (command.kind === "daemon") yield* runs!.stop(command, reason)
        if (command.kind === "spawned" && command.info.status === "running" && command.stop) yield* command.stop(reason)
        return command.info
      })

      const detachable = (id: Shell.ID) => find(id)?.kind === "daemon"

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
        if (command.kind === "daemon") {
          const page = yield* readFile(command.info.file, () => cursor, limit)
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
        const bytes = yield* readSpawned(command.info.file, start, Math.min(limit, command.size - start))
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
      const tail = Effect.fnUntraced(function* (command: Command, maxBytes: number) {
        if (command.kind === "spawned") {
          const start = Math.max(0, command.size - maxBytes)
          const bytes = yield* readSpawned(command.info.file, start, command.size - start)
          return {
            text: bytes.toString("utf8"),
            size: command.size,
            newlines: command.newlines,
            error: undefined,
            killed: undefined,
          }
        }
        const page = yield* readFile(command.info.file, (size) => size - maxBytes, maxBytes)
        return {
          text: page.bytes.toString("utf8"),
          size: page.size,
          // The daemon's count, unless the command ended without its exit report (the daemon went away).
          newlines: command.outputLines ?? (yield* countNewlines(command.info.file)),
          error: command.outputError,
          killed: command.killed,
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
          return {
            output: `${text || "(no output)"}${notice}${error}`,
            truncated,
            lines: { shown, total },
            ...(page.killed ? { killed: page.killed } : {}),
          }
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
              foreground: input.foreground === true,
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
                done: Deferred.makeUnsafe<Info, NotFoundError>(),
              }
              spawned.set(id, command)

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

      return Service.of({
        create,
        list,
        get,
        wait,
        result,
        timeout,
        stop,
        detachable,
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
    daemonNode,
    cleanupNode,
  ],
})
