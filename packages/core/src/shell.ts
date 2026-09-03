export * as Shell from "./shell.js"

import path from "path"
import { Context, Deferred, Duration, Effect, Fiber, Latch, Layer, Schema, Schedule, Stream } from "effect"
import { ChildProcess } from "effect/unstable/process"
import { produce } from "immer"
import { Shell } from "@opencode-ai/schema/shell"
import { AppProcess } from "@opencode-ai/util/process"
import { makeGlobalNode, makeLocationNode } from "@opencode-ai/util/effect/app-node"
import { FSUtil } from "@opencode-ai/util/fs-util"
import { Bus } from "./bus.js"
import { Environment } from "./environment/index.js"
import { FileRetention } from "./file-retention.js"
import { Location } from "./location.js"
import { Global } from "@opencode-ai/util/global"
import { ShellSelect } from "./shell/select.js"
import type { ShellCreateBefore } from "@opencode-ai/plugin/effect/shell"
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

type Info = Shell.Info
type CreateInput = Shell.CreateInput & {
  shell?: string
}

type Active = {
  // Immutable snapshot; lifecycle updates replace it via immer `produce`.
  info: Info
  file: string
  size: number
  // Resolves with the terminal Info once the command exits, times out, or is killed. A wait
  // started after termination resolves immediately from the already-completed deferred.
  done: Deferred.Deferred<ShellResult.TerminalInfo, NotFoundError>
  timeoutFiber?: Fiber.Fiber<void>
  timeout?: (duration: number) => Effect.Effect<void>
  stop?: Effect.Effect<void>
}

/**
 * Location-owned non-interactive shell command process service.
 *
 * Each `create` spawns one shell command, captures combined stdout/stderr to a
 * file, and returns an ID. Clients poll `get` for status and `output` for
 * file-backed output by cursor. No session, message, or permission state lives
 * here; callers (e.g. `ShellTool`) own that association and store the shell ID.
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
  readonly wait: (id: Shell.ID) => Effect.Effect<ShellResult.TerminalInfo, NotFoundError>
  // A known terminal state and bounded tail, or `unavailable` if observation outlives retention/removal.
  readonly result: (started: Shell.Info) => Effect.Effect<ShellResult.Result>
  // Replaces the running command's timeout from now; zero clears it.
  readonly timeout: (id: Shell.ID, duration: number) => Effect.Effect<Shell.Info, NotFoundError>
  readonly output: (id: Shell.ID, input?: Shell.OutputInput) => Effect.Effect<Shell.Output, NotFoundError>
  // Kills a running command. It ends as `killed` and stays observable like any exited command, so
  // waiters see the real terminal Info and its captured output remains readable. Stopping is not
  // removal: `remove` forgets the command and its capture. Resolves once the command is terminal.
  readonly stop: (id: Shell.ID) => Effect.Effect<Shell.Info, NotFoundError>
  readonly remove: (id: Shell.ID) => Effect.Effect<void, NotFoundError>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/Shell") {}

export const cleanup = Effect.fn("Shell.cleanup")(function* () {
  const fs = yield* FSUtil.Service
  const global = yield* Global.Service
  const directory = path.join(global.data, DIRECTORY)
  const projects = yield* fs.readDirectoryEntries(directory).pipe(
    Effect.map((entries) => entries.filter((entry) => entry.type === "directory")),
    Effect.orElseSucceed(() => []),
  )
  const files = yield* Effect.forEach(
    projects,
    (project) =>
      fs.readDirectoryEntries(path.join(directory, project.name)).pipe(
        Effect.map((entries) =>
          entries.flatMap((entry) =>
            entry.type === "file" && /^sh_[0-9a-f]{12}.*\.out$/.test(entry.name)
              ? [path.join(directory, project.name, entry.name)]
              : [],
          ),
        ),
        Effect.orElseSucceed(() => []),
      ),
    { concurrency: 8 },
  )
  yield* FileRetention.cleanup(fs, files.flat(), RETENTION)
})

const cleanupLayer = Layer.effectDiscard(
  cleanup().pipe(Effect.repeat(Schedule.spaced(Duration.hours(1))), Effect.forkScoped),
)

const cleanupNode = makeGlobalNode({
  name: "shell-output-cleanup",
  layer: cleanupLayer,
  deps: [FSUtil.node, Global.node],
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
      const context = yield* Effect.context()
      const runFork = Effect.runForkWith(context)
      const commands = new Map<Shell.ID, Active>()
      const exitOrder: Shell.ID[] = []

      const outputDir = path.join(global.data, DIRECTORY, location.project.id)
      const { mkdir, unlink } = yield* Effect.promise(() => import("fs/promises"))
      const { createWriteStream, createReadStream } = yield* Effect.promise(() => import("fs"))
      yield* Effect.promise(() => mkdir(outputDir, { recursive: true }))

      yield* Effect.addFinalizer(() =>
        Effect.gen(function* () {
          for (const command of commands.values()) {
            if (command.timeoutFiber) yield* Fiber.interrupt(command.timeoutFiber)
            // Teardown interrupts pending commands; it is not a terminal command failure.
            yield* Deferred.interrupt(command.done)
          }
          commands.clear()
          exitOrder.length = 0
        }),
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
        // Unblock any wait still pending when the command is removed before it terminated.
        yield* Deferred.fail(command.done, new NotFoundError({ id }))
        yield* Effect.promise(() => unlink(command.file).catch(() => {}))
        yield* bus.publish(Shell.Event.Deleted, { id })
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

      const stop = Effect.fn("Shell.stop")(function* (id: Shell.ID) {
        const command = yield* require(id)
        // Once accepted, a client's cancellation cannot abandon killing or capture settlement.
        // Concurrent callers wait on the same completion, not the early status change.
        if (command.info.status === "running" && command.stop) yield* command.stop
        return yield* Deferred.await(command.done)
      }, Effect.uninterruptible)

      const output = Effect.fnUntraced(function* (id: Shell.ID, input?: Shell.OutputInput) {
        const command = yield* require(id)
        const cursor = input?.cursor ?? 0
        const limit = input?.limit ?? 65536
        if (cursor >= command.size) return { output: "", cursor: command.size, size: command.size, truncated: false }
        const start = Math.max(0, cursor)
        const length = Math.min(limit, command.size - start)
        const buffer = Buffer.alloc(length)
        const bytesRead = yield* Effect.promise(
          () =>
            new Promise<number>((resolve) => {
              const stream = createReadStream(command.file, { start, end: start + length - 1 })
              let offset = 0
              stream.on("data", (chunk: string | Buffer) => {
                const bytes = Buffer.from(chunk)
                bytes.copy(buffer, offset)
                offset += bytes.length
              })
              stream.on("end", () => resolve(offset))
              stream.on("error", () => resolve(0))
            }),
        )
        return {
          output: buffer.subarray(0, bytesRead).toString("utf8"),
          cursor: start + bytesRead,
          size: command.size,
          truncated: false,
        }
      })

      const result = Effect.fn("Shell.result")(function* (started: Shell.Info) {
        const info = yield* wait(started.id).pipe(
          Effect.catchTag("Shell.NotFoundError", () => Effect.succeed({ ...started, status: "unavailable" as const })),
        )
        const capture = yield* Effect.gen(function* () {
          const limits = Config.latest(yield* config.entries(), "tool_output")
          const maxLines = limits?.max_lines ?? ToolOutput.MAX_LINES
          const maxBytes = limits?.max_bytes ?? ToolOutput.MAX_BYTES
          const latest = yield* output(info.id, { cursor: Number.MAX_SAFE_INTEGER })
          const page = yield* output(info.id, { cursor: Math.max(0, latest.size - maxBytes), limit: maxBytes })
          const lines = page.output.split("\n")
          if (page.output.endsWith("\n")) lines.pop()
          const truncated = latest.size > maxBytes || lines.length > maxLines
          const text = lines.length > maxLines ? lines.slice(-maxLines).join("\n") : page.output
          const notice = truncated ? `\n\n[output truncated; full output saved to: ${info.file}]` : ""
          return { output: `${text || "(no output)"}${notice}`, truncated }
        }).pipe(Effect.catchTag("Shell.NotFoundError", () => Effect.succeed(undefined)))
        return { info, capture }
      })

      const create = Effect.fn("Shell.create")(function* <E = never, R = never>(
        input: CreateInput,
        before?: (input: ShellCreateBefore) => Effect.Effect<void, E, R>,
      ) {
        const sessionID = input.metadata?.sessionID
        const sessionEnvironment =
          location.workspaceID === undefined && Schema.is(SessionSchema.ID)(sessionID)
            ? yield* environments.get(sessionID)
            : undefined
        const invocation: ShellCreateBefore = {
          command: input.command,
          cwd: input.cwd ?? location.directory,
          timeout: input.timeout,
          shell: input.shell ?? (yield* shell.resolve({ priority: "config" })),
          env: {
            ...(sessionEnvironment ?? process.env),
            TERM: "xterm-256color",
            OPENCODE_TERMINAL: "1",
          },
        }
        yield* hooks.trigger("shell", "create.before", invocation)
        if (before) yield* before(invocation)

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
                    forceKillAfter: Duration.seconds(3),
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
                done: Deferred.makeUnsafe<ShellResult.TerminalInfo, NotFoundError>(),
              }
              commands.set(id, command)

              const stream = createWriteStream(file)
              const outputDone = Latch.makeUnsafe()
              const pump = handle.all.pipe(
                Stream.runForEach((chunk: Uint8Array) =>
                  Effect.sync(() => {
                    stream.write(chunk)
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

              const finish = (status: ShellResult.TerminalInfo["status"], exit?: number, beforeWait = Effect.void) =>
                Effect.gen(function* () {
                  if (command.info.status !== "running") return
                  const info = {
                    ...command.info,
                    status,
                    ...(exit !== undefined ? { exit } : {}),
                    time: { ...command.info.time, completed: Date.now() },
                  }
                  command.info = info
                  yield* beforeWait
                  yield* outputDone.await
                  // Resolve waiters with the terminal Info before any retention eviction, so an evicted
                  // command still reports success rather than the removal NotFoundError. This runs before
                  // the timeout-fiber interrupt below, which on the timeout path would otherwise cancel
                  // this very fiber (finish is invoked by the timeout fiber) before waiters are resolved.
                  yield* Deferred.succeed(command.done, info)
                  yield* bus.publish(Shell.Event.Exited, {
                    id,
                    ...(exit !== undefined ? { exit } : {}),
                    status,
                  })
                  exitOrder.push(id)
                  while (exitOrder.length > EXITED_LIMIT) {
                    const oldest = exitOrder[0]
                    if (!oldest) break
                    yield* removeCommand(oldest)
                  }
                  // Keep exited history data-only. Interrupt last because finish may run on the timeout fiber.
                  const timeoutFiber = command.timeoutFiber
                  command.timeout = undefined
                  command.stop = undefined
                  command.timeoutFiber = undefined
                  if (timeoutFiber) yield* Fiber.interrupt(timeoutFiber)
                })

              command.timeout = (duration) =>
                Effect.gen(function* () {
                  if (command.timeoutFiber) yield* Fiber.interrupt(command.timeoutFiber)
                  command.timeoutFiber = undefined
                  if (duration === 0 || command.info.status !== "running") return
                  command.timeoutFiber = runFork(
                    Effect.sleep(Duration.millis(duration)).pipe(
                      Effect.flatMap(() =>
                        finish(
                          "timeout",
                          undefined,
                          handle.kill({ forceKillAfter: Duration.seconds(3) }).pipe(Effect.catch(() => Effect.void)),
                        ),
                      ),
                    ),
                  )
                })

              yield* command.timeout(invocation.timeout)
              command.stop = finish(
                "killed",
                undefined,
                handle.kill({ forceKillAfter: Duration.seconds(3) }).pipe(Effect.catch(() => Effect.void)),
              )

              runFork(
                handle.exitCode.pipe(
                  Effect.flatMap((code) => finish("exited", code)),
                  Effect.catch(() => finish("exited")),
                ),
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

      return Service.of({ create, list, get, wait, result, timeout, output, stop, remove })
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
    cleanupNode,
  ],
})
